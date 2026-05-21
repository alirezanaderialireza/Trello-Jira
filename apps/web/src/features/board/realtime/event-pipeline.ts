// apps/web/src/features/board/realtime/event-pipeline.ts
//
// Phase-1 abstraction #3 — Event Pipeline
//
// 5-stage linear pipeline: every WS message flows through these stages in order.
//
//   socket   — raw WebSocket frame arrives (string | ArrayBuffer)
//     ↓
//   validate — JSON parse + schema check; rejects malformed frames
//     ↓
//   sequence — sequence contiguity check; detects gaps / duplicates
//     ↓
//   buffer   — out-of-order events are parked; in-order events proceed
//     ↓
//   dispatch — pure reducer applied; invariants checked
//
// Each stage is a pure function: (input, context) → output | PipelineError.
// No Zustand, no React, no WebSocket in this file.

import type { AppDomainEvent } from "@repo/domain";
import type { WsEvent } from "../api/realtime/types";
import type { BoardStoreState } from "../store/useBoardStore";
import {
  parseSequence,
  isContiguous,
  isStaleOrDuplicate,
} from "../store/event-application/sequence";
import {
  validateStoreInvariants,
  type InvariantViolation,
} from "../store/invariants";

// ============================================================================
// Shared result type
// ============================================================================

export type PipelineOk<T>   = { ok: true;  value: T };
export type PipelineErr     = { ok: false; stage: PipelineStage; reason: string };
export type PipelineResult<T> = PipelineOk<T> | PipelineErr;

export type PipelineStage =
  | "validate"
  | "sequence"
  | "buffer"
  | "dispatch"
  | "invariant";

function ok<T>(value: T): PipelineOk<T>          { return { ok: true, value }; }
function err(stage: PipelineStage, reason: string): PipelineErr {
  return { ok: false, stage, reason };
}

// ============================================================================
// Stage 1 — validate
// ============================================================================

export interface ValidatedFrame {
  sequence: string;
  event:    AppDomainEvent;
}

/**
 * Parse a raw WebSocket data payload and validate it has the minimum shape
 * of a WsEvent. Rejects anything that is not valid JSON or missing fields.
 */
export function validateFrame(raw: unknown): PipelineResult<ValidatedFrame> {
  // Already a parsed WsEvent (from boardSocketClient)
  if (
    raw !== null &&
    typeof raw === "object" &&
    "sequence" in raw &&
    "payload" in raw
  ) {
    const ws = raw as WsEvent;
    if (typeof ws.sequence !== "string" || !ws.sequence) {
      return err("validate", "WsEvent missing sequence");
    }
    if (!ws.payload || typeof ws.payload.type !== "string") {
      return err("validate", "WsEvent payload missing type");
    }
    return ok({ sequence: ws.sequence, event: ws.payload });
  }

  // Raw string frame from WebSocket.onmessage
  if (typeof raw === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err("validate", "JSON parse failed");
    }

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "sequence" in parsed &&
      "payload" in parsed
    ) {
      const ws = parsed as WsEvent;
      if (typeof ws.sequence !== "string") {
        return err("validate", "sequence must be string");
      }
      if (!ws.payload || typeof ws.payload.type !== "string") {
        return err("validate", "payload.type missing");
      }
      return ok({ sequence: ws.sequence, event: ws.payload });
    }

    return err("validate", "frame does not match WsEvent shape");
  }

  return err("validate", `unexpected frame type: ${typeof raw}`);
}

// ============================================================================
// Stage 2 — sequence
// ============================================================================

export type SequenceDecision =
  | { action: "apply";  frame: ValidatedFrame }   // in-order, apply now
  | { action: "buffer"; frame: ValidatedFrame }   // gap detected, park it
  | { action: "drop";   reason: string }           // duplicate / stale

/**
 * Decide what to do with a validated frame based on sequence numbers.
 *
 * @param frame          Validated frame
 * @param currentSeq     Current boardSequence from the store
 */
export function checkSequence(
  frame:      ValidatedFrame,
  currentSeq: string,
): PipelineResult<SequenceDecision> {
  const incoming = frame.sequence;

  if (isStaleOrDuplicate(currentSeq, incoming)) {
    return ok({
      action: "drop",
      reason: `stale: incoming=${incoming} current=${currentSeq}`,
    });
  }

  if (isContiguous(currentSeq, incoming)) {
    return ok({ action: "apply", frame });
  }

  // Gap detected: incoming > currentSeq + 1
  return ok({ action: "buffer", frame });
}

// ============================================================================
// Stage 3 — buffer
// ============================================================================

/**
 * A simple in-memory buffer for out-of-order events.
 * Keyed by sequence string for O(1) insert / delete.
 *
 * drain() returns all contiguous events starting from currentSeq+1
 * in ascending order, removing them from the buffer.
 */
export class ReplayBuffer {
  private readonly store = new Map<string, ValidatedFrame>();
  private readonly maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  get size(): number { return this.store.size; }

  get isFull(): boolean { return this.store.size >= this.maxSize; }

  /** Add a frame to the buffer. Returns false if buffer is full. */
  add(frame: ValidatedFrame): boolean {
    if (this.store.size >= this.maxSize) return false;
    this.store.set(frame.sequence, frame);
    return true;
  }

  /**
   * Drain all contiguous frames starting from currentSeq + 1.
   * Removes drained frames from the buffer.
   * Discards frames with seq <= currentSeq (stale).
   */
  drain(currentSeq: string): ValidatedFrame[] {
    const drained: ValidatedFrame[] = [];

    // Sort keys ascending using BigInt comparison
    const sorted = [...this.store.keys()].sort((a, b) => {
      const diff = parseSequence(a) - parseSequence(b);
      return diff < 0n ? -1 : diff > 0n ? 1 : 0;
    });

    let running = currentSeq;

    for (const seq of sorted) {
      if (isStaleOrDuplicate(running, seq)) {
        this.store.delete(seq);          // discard stale
        continue;
      }
      if (isContiguous(running, seq)) {
        const frame = this.store.get(seq)!;
        this.store.delete(seq);
        drained.push(frame);
        running = seq;
      } else {
        break;                           // gap still present — stop
      }
    }

    return drained;
  }

  clear(): void { this.store.clear(); }
}

// ============================================================================
// Stage 4 — dispatch
// ============================================================================

export interface DispatchResult {
  nextState:   BoardStoreState;
  newSequence: string;
}

type ReducerFn = (
  state:    BoardStoreState,
  envelope: { event: AppDomainEvent; optimistic?: boolean; acknowledged?: boolean },
  ctx:      { mode: "live" },
) => Partial<BoardStoreState>;

/**
 * Apply a validated frame to the current store state via the reducer fn.
 * Returns the merged next state and the new boardSequence.
 *
 * @param frame    Validated, in-order frame
 * @param state    Current BoardStoreState (immutable input)
 * @param reducer  The `applyEvent` function from dispatcher.ts
 */
export function dispatchFrame(
  frame:   ValidatedFrame,
  state:   BoardStoreState,
  reducer: ReducerFn,
): PipelineResult<DispatchResult> {
  try {
    const envelope = { event: frame.event, acknowledged: true };
    const partial  = reducer(state, envelope, { mode: "live" });
    const nextState: BoardStoreState = {
      ...state,
      ...partial,
      boardSequence: frame.sequence,
    };
    return ok({ nextState, newSequence: frame.sequence });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "reducer threw";
    return err("dispatch", msg);
  }
}

// ============================================================================
// Stage 5 — invariant check
// ============================================================================

export interface InvariantCheckResult {
  valid:      boolean;
  violations: InvariantViolation[];
}

/**
 * Run all 4 store invariants against the post-dispatch state.
 * Returns the violation list so callers can decide whether to
 * apply the state or trigger a resync.
 */
export function checkInvariants(
  state: BoardStoreState,
): PipelineResult<InvariantCheckResult> {
  try {
    const result = validateStoreInvariants(state);
    return ok(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "invariant check threw";
    return err("invariant", msg);
  }
}

// ============================================================================
// Full pipeline (convenience wrapper)
// ============================================================================

export interface PipelineOutput {
  nextState:   BoardStoreState;
  newSequence: string;
  violations:  InvariantViolation[];   // non-empty = trigger resync
  buffered:    ValidatedFrame[];       // additional frames drained from buffer
}

/**
 * Run a single WsEvent through all 5 pipeline stages.
 *
 * @param raw      Raw frame from the WebSocket (WsEvent object or JSON string)
 * @param state    Current BoardStoreState
 * @param buffer   ReplayBuffer instance (shared across calls)
 * @param reducer  applyEvent from dispatcher.ts
 *
 * Returns PipelineOk<PipelineOutput> on success, PipelineErr on any stage failure.
 */
export function runPipeline(
  raw:     unknown,
  state:   BoardStoreState,
  buffer:  ReplayBuffer,
  reducer: ReducerFn,
): PipelineResult<PipelineOutput> {
  // ── Stage 1: Validate ──────────────────────────────────────────────────────
  const v = validateFrame(raw);
  if (!v.ok) return v;

  // ── Stage 2: Sequence ──────────────────────────────────────────────────────
  const s = checkSequence(v.value, state.boardSequence);
  if (!s.ok) return s;

  if (s.value.action === "drop") {
    // Duplicate / stale — return current state unchanged
    return ok({
      nextState:   state,
      newSequence: state.boardSequence,
      violations:  [],
      buffered:    [],
    });
  }

  if (s.value.action === "buffer") {
    // ── Stage 3: Buffer ──────────────────────────────────────────────────────
    if (buffer.isFull) {
      return err("buffer", `replay buffer full (${buffer.size} events)`);
    }
    buffer.add(s.value.frame);
    return ok({
      nextState:   state,
      newSequence: state.boardSequence,
      violations:  [],
      buffered:    [],
    });
  }

  // action === "apply" — run through stages 4 + 5, then drain buffer
  let currentState = state;
  let allViolations: InvariantViolation[] = [];

  const framesToApply: ValidatedFrame[] = [
    s.value.frame,
    ...buffer.drain(s.value.frame.sequence),
  ];

  for (const frame of framesToApply) {
    // ── Stage 4: Dispatch ────────────────────────────────────────────────────
    const d = dispatchFrame(frame, currentState, reducer);
    if (!d.ok) return d;

    // ── Stage 5: Invariants ──────────────────────────────────────────────────
    const i = checkInvariants(d.value.nextState);
    if (!i.ok) return i;

    currentState = d.value.nextState;
    allViolations = [...allViolations, ...i.value.violations];
  }

  return ok({
    nextState:   currentState,
    newSequence: currentState.boardSequence,
    violations:  allViolations,
    buffered:    framesToApply.slice(1),   // frames that came from the buffer
  });
}
