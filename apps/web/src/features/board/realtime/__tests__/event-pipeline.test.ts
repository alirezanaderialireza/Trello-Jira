// apps/web/src/features/board/realtime/__tests__/event-pipeline.test.ts
//
// Phase-1 — Event Pipeline tests
// Covers: validateFrame, checkSequence, ReplayBuffer, dispatchFrame,
//         checkInvariants, and the full runPipeline integration.

import { describe, it, expect, vi } from "vitest";
import {
  validateFrame,
  checkSequence,
  ReplayBuffer,
  dispatchFrame,
  checkInvariants,
  runPipeline,
  type ValidatedFrame,
  type PipelineResult,
} from "../event-pipeline";
import { createBoardState } from "../../store/test-utils/createBoardState";
import type { BoardStoreState } from "../../store/useBoardStore";
import type { AppDomainEvent } from "@repo/domain";

// ── helpers ─────────────────────────────────────────────────────────────────

function makeFrame(seq: string, type = "card.updated"): ValidatedFrame {
  return {
    sequence: seq,
    event: {
      id: `evt-${seq}`,
      type: type as AppDomainEvent["type"],
      version: 2,
      occurredAt: "2024-01-01T00:00:00Z",
      aggregateId: "c1",
      aggregateType: "card",
      payload: { cardId: "c1", boardId: "b1", changes: { title: `t${seq}` } },
    } as AppDomainEvent,
  };
}

function makeWsEvent(seq: string, type = "card.updated") {
  return {
    sequence: seq,
    type,
    payload: makeFrame(seq, type).event,
  };
}

function cleanState(): BoardStoreState {
  return createBoardState({
    lists:       { l1: { id: "l1", title: "L1", position: "a", revision: 1 } },
    cards:       { c1: { id: "c1", boardId: "b1", listId: "l1", title: "t0", position: "a", revision: 1 } },
    cardsByList: { l1: ["c1"] },
    listOrder:   ["l1"],
    boardSequence: "100",
  });
}

// identity reducer for pipeline tests (no domain processing needed)
const identityReducer = (
  state: BoardStoreState,
  _env: unknown,
  _ctx: unknown,
): Partial<BoardStoreState> => ({});

// ============================================================================
// Stage 1 — validateFrame
// ============================================================================

describe("validateFrame", () => {
  it("accepts a pre-parsed WsEvent object", () => {
    const ws = makeWsEvent("101");
    const r  = validateFrame(ws);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sequence).toBe("101");
      expect(r.value.event.type).toBe("card.updated");
    }
  });

  it("accepts a JSON-stringified WsEvent", () => {
    const ws  = makeWsEvent("102");
    const raw = JSON.stringify(ws);
    const r   = validateFrame(raw);
    expect(r.ok).toBe(true);
  });

  it("rejects invalid JSON string", () => {
    const r = validateFrame("{not_json");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("validate");
      expect(r.reason).toContain("JSON parse");
    }
  });

  it("rejects missing sequence", () => {
    const r = validateFrame({ payload: makeFrame("103").event });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("validate");
  });

  it("rejects empty sequence string", () => {
    const r = validateFrame({ sequence: "", payload: makeFrame("104").event });
    expect(r.ok).toBe(false);
  });

  it("rejects missing payload.type", () => {
    const r = validateFrame({ sequence: "105", payload: { id: "x" } });
    expect(r.ok).toBe(false);
  });

  it("rejects null / undefined", () => {
    expect(validateFrame(null).ok).toBe(false);
    expect(validateFrame(undefined).ok).toBe(false);
  });

  it("rejects number type", () => {
    expect(validateFrame(42).ok).toBe(false);
  });
});

// ============================================================================
// Stage 2 — checkSequence
// ============================================================================

describe("checkSequence", () => {
  it("apply: incoming = current + 1", () => {
    const r = checkSequence(makeFrame("101"), "100");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.action).toBe("apply");
  });

  it("buffer: gap detected (current=100, incoming=103)", () => {
    const r = checkSequence(makeFrame("103"), "100");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.action).toBe("buffer");
  });

  it("drop: duplicate (incoming == current)", () => {
    const r = checkSequence(makeFrame("100"), "100");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.action).toBe("drop");
    }
  });

  it("drop: stale (incoming < current)", () => {
    const r = checkSequence(makeFrame("99"), "100");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.action).toBe("drop");
  });
});

// ============================================================================
// Stage 3 — ReplayBuffer
// ============================================================================

describe("ReplayBuffer", () => {
  it("buffers frames and drains in order", () => {
    const buf = new ReplayBuffer(100);
    buf.add(makeFrame("103"));
    buf.add(makeFrame("102"));

    expect(buf.size).toBe(2);

    const drained = buf.drain("101");
    expect(drained).toHaveLength(2);
    expect(drained[0].sequence).toBe("102");
    expect(drained[1].sequence).toBe("103");
    expect(buf.size).toBe(0);
  });

  it("stops drain at a gap", () => {
    const buf = new ReplayBuffer(100);
    buf.add(makeFrame("102"));
    buf.add(makeFrame("104"));   // gap at 103

    const drained = buf.drain("101");
    expect(drained).toHaveLength(1);
    expect(drained[0].sequence).toBe("102");
    expect(buf.size).toBe(1);   // 104 remains
  });

  it("discards stale frames during drain", () => {
    const buf = new ReplayBuffer(100);
    buf.add(makeFrame("98"));
    buf.add(makeFrame("99"));
    buf.add(makeFrame("101"));

    const drained = buf.drain("100");
    // 98 and 99 are stale (≤ 100), 101 is contiguous
    expect(drained.map((f) => f.sequence)).toEqual(["101"]);
    expect(buf.size).toBe(0);
  });

  it("returns false and stays full when at capacity", () => {
    const buf = new ReplayBuffer(2);
    expect(buf.add(makeFrame("101"))).toBe(true);
    expect(buf.add(makeFrame("102"))).toBe(true);
    expect(buf.isFull).toBe(true);
    expect(buf.add(makeFrame("103"))).toBe(false);
  });

  it("clear() empties the buffer", () => {
    const buf = new ReplayBuffer(100);
    buf.add(makeFrame("101"));
    buf.clear();
    expect(buf.size).toBe(0);
  });
});

// ============================================================================
// Stage 4 — dispatchFrame
// ============================================================================

describe("dispatchFrame", () => {
  it("merges partial state and advances boardSequence", () => {
    const state  = cleanState();
    const frame  = makeFrame("101");
    const partialReducer = (
      s: BoardStoreState,
      _env: unknown,
      _ctx: unknown,
    ): Partial<BoardStoreState> => ({
      cards: {
        ...s.cards,
        c1: { ...s.cards["c1"]!, title: "updated" },
      },
    });

    const r = dispatchFrame(frame, state, partialReducer as any);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.newSequence).toBe("101");
      expect(r.value.nextState.boardSequence).toBe("101");
      expect(r.value.nextState.cards["c1"]?.title).toBe("updated");
    }
  });

  it("returns PipelineErr when reducer throws", () => {
    const throwingReducer = () => { throw new Error("reducer exploded"); };
    const r = dispatchFrame(makeFrame("101"), cleanState(), throwingReducer as any);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("dispatch");
      expect(r.reason).toContain("reducer exploded");
    }
  });

  it("does not mutate input state", () => {
    const state  = cleanState();
    const frozen = structuredClone(state);
    dispatchFrame(makeFrame("101"), state, identityReducer as any);
    expect(state).toEqual(frozen);
  });
});

// ============================================================================
// Stage 5 — checkInvariants
// ============================================================================

describe("checkInvariants", () => {
  it("returns valid:true for a clean state", () => {
    const r = checkInvariants(cleanState());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.valid).toBe(true);
  });

  it("returns valid:false for a corrupted state (orphan card)", () => {
    const corrupt = createBoardState({
      lists:       { l1: { id: "l1", title: "L1", position: "a", revision: 1 } },
      cards:       {
        c1: { id: "c1", boardId: "b1", listId: "l1", title: "T", position: "a", revision: 1 },
        orphan: { id: "orphan", boardId: "b1", listId: "l1", title: "X", position: "b", revision: 1 },
      },
      cardsByList: { l1: ["c1"] },   // orphan not in bucket
      listOrder:   ["l1"],
    });
    const r = checkInvariants(corrupt);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.valid).toBe(false);
      expect(r.value.violations.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// Full runPipeline integration
// ============================================================================

describe("runPipeline", () => {
  it("applies an in-order event and advances sequence", () => {
    const state  = cleanState(); // boardSequence = "100"
    const buffer = new ReplayBuffer(100);
    const ws     = makeWsEvent("101");

    const r = runPipeline(ws, state, buffer, identityReducer as any);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.newSequence).toBe("101");
      expect(r.value.violations).toHaveLength(0);
      expect(r.value.buffered).toHaveLength(0);
    }
  });

  it("buffers an out-of-order event and returns current state", () => {
    const state  = cleanState();
    const buffer = new ReplayBuffer(100);
    const ws     = makeWsEvent("103"); // gap at 101, 102

    const r = runPipeline(ws, state, buffer, identityReducer as any);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.newSequence).toBe("100");   // unchanged
      expect(buffer.size).toBe(1);
    }
  });

  it("drops a duplicate event with no state change", () => {
    const state  = cleanState();
    const buffer = new ReplayBuffer(100);
    const ws     = makeWsEvent("100"); // same as current

    const r = runPipeline(ws, state, buffer, identityReducer as any);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.newSequence).toBe("100");
      expect(r.value.buffered).toHaveLength(0);
    }
  });

  it("drains buffer after gap is filled", () => {
    const state  = cleanState(); // seq = 100
    const buffer = new ReplayBuffer(100);

    // 103 arrives first (gap)
    runPipeline(makeWsEvent("103"), state, buffer, identityReducer as any);
    expect(buffer.size).toBe(1);

    // 102 arrives — still gap at 101
    runPipeline(makeWsEvent("102"), state, buffer, identityReducer as any);
    expect(buffer.size).toBe(2);

    // 101 arrives — fills the gap; 102 and 103 should drain
    const r = runPipeline(makeWsEvent("101"), state, buffer, identityReducer as any);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.newSequence).toBe("103");
      expect(r.value.buffered).toHaveLength(2);
      expect(buffer.size).toBe(0);
    }
  });

  it("returns PipelineErr when buffer is full and gap detected", () => {
    const state  = cleanState();
    const buffer = new ReplayBuffer(1);  // tiny buffer

    // Fill the buffer
    runPipeline(makeWsEvent("103"), state, buffer, identityReducer as any);
    expect(buffer.isFull).toBe(true);

    // Another out-of-order event → err("buffer", ...)
    const r = runPipeline(makeWsEvent("104"), state, buffer, identityReducer as any);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("buffer");
  });

  it("rejects invalid frame at stage 1", () => {
    const r = runPipeline("{bad", cleanState(), new ReplayBuffer(100), identityReducer as any);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("validate");
  });

  it("violations non-empty when invariant broken after dispatch", () => {
    // Reducer that deliberately introduces an orphan card
    const corruptingReducer = (s: BoardStoreState): Partial<BoardStoreState> => ({
      cards: {
        ...s.cards,
        ghost: {
          id: "ghost", boardId: "b1", listId: "l1",
          title: "ghost", position: "z", revision: 1,
        },
      },
      // cardsByList intentionally NOT updated → INV-4 violation
    });

    const r = runPipeline(
      makeWsEvent("101"),
      cleanState(),
      new ReplayBuffer(100),
      corruptingReducer as any,
    );

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.violations.length).toBeGreaterThan(0);
    }
  });
});
