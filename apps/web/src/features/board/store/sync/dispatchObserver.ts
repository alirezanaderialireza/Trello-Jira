// apps/web/src/features/board/store/sync/dispatchObserver.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Wraps the dispatcher to observe every reducer invocation for:
//
//   1. Purity validation (test-time) — detects mutations of input state.
//   2. Anomaly detection (runtime) — tracks unexpected empty returns,
//      reducer crashes, and performance violations.
//   3. Audit trail — emits a structured log for every applied event,
//      enabling post-hoc debugging without replay.
//   4. Determinism assertion (test-time) — applies same event twice,
//      verifies identical output.
//
// ─── Integration ─────────────────────────────────────────────────────────────
// This module does NOT replace the dispatcher. It wraps it:
//
//   import { observeDispatch } from "./dispatchObserver";
//   const result = observeDispatch(state, envelope, context);
//   // result.partial  = what the reducer returned
//   // result.anomaly  = null | AnomalyReport
//
// In production builds, the observer short-circuits to zero-overhead
// (the `observe` flag defaults to process.env.NODE_ENV !== "production").
//
// In test builds, full purity + determinism checks are enabled.
//
// ─── Design rules ────────────────────────────────────────────────────────────
//   • Zero allocation in production (early return when disabled).
//   • Pure observation — never mutates state or envelope.
//   • Injectable — observer config can be overridden per-test.
//   • Structured output — anomalies are typed, not just console.warn strings.
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "../event-application/types";
import type { ReducerContext } from "../event-application/context";
import { applyEvent } from "../event-application/dispatcher";
import { telemetry } from "../../devtools/logEvent";
import { canonicalJSON } from "./canonicalSerializer";

// ============================================================================
// 1.  Public Types
// ============================================================================

export type AnomalyKind =
  | "REDUCER_CRASH"
  | "EMPTY_RETURN"
  | "STATE_MUTATION_DETECTED"
  | "NON_DETERMINISTIC"
  | "SLOW_REDUCER";

export interface AnomalyReport {
  readonly kind: AnomalyKind;
  readonly eventType: string;
  readonly eventId: string;
  readonly correlationId?: string;
  readonly details: Record<string, unknown>;
  readonly timestamp: number;
}

export interface ObserveResult {
  /** The partial state returned by the reducer. */
  readonly partial: Partial<BoardStoreState>;
  /** Non-null if an anomaly was detected. */
  readonly anomaly: AnomalyReport | null;
  /** Wall-clock ms the reducer took. */
  readonly durationMs: number;
}

export interface ObserverConfig {
  /** Enable purity check (structuredClone before + deep compare after). Default: !production. */
  readonly purityCheck: boolean;
  /** Enable determinism check (apply twice, compare outputs). Default: false (expensive). */
  readonly determinismCheck: boolean;
  /** Max ms a reducer is allowed before flagging SLOW_REDUCER. Default: 8. */
  readonly slowThresholdMs: number;
  /** Whether to emit telemetry logs for every event. Default: true in dev. */
  readonly telemetryEnabled: boolean;
}

const DEFAULT_CONFIG: ObserverConfig = {
  purityCheck:       process.env.NODE_ENV !== "production",
  determinismCheck:  false,
  slowThresholdMs:   8,
  telemetryEnabled:  process.env.NODE_ENV !== "production",
};

// ============================================================================
// 2.  Singleton config — can be overridden for testing
// ============================================================================

let _config: ObserverConfig = { ...DEFAULT_CONFIG };

export function configureObserver(overrides: Partial<ObserverConfig>): void {
  _config = { ..._config, ...overrides };
}

export function resetObserverConfig(): void {
  _config = { ...DEFAULT_CONFIG };
}

export function getObserverConfig(): Readonly<ObserverConfig> {
  return _config;
}

// ============================================================================
// 3.  Anomaly accumulator — allows tests to inspect all anomalies
// ============================================================================

const _anomalies: AnomalyReport[] = [];
const MAX_ANOMALY_BUFFER = 200;

export function getAnomalies(): readonly AnomalyReport[] {
  return _anomalies;
}

export function clearAnomalies(): void {
  _anomalies.length = 0;
}

function recordAnomaly(anomaly: AnomalyReport): void {
  _anomalies.push(anomaly);
  if (_anomalies.length > MAX_ANOMALY_BUFFER) {
    _anomalies.shift();
  }

  if (_config.telemetryEnabled) {
    telemetry.log("STORE", "DISPATCH_ANOMALY", {
      kind:          anomaly.kind,
      eventType:     anomaly.eventType,
      eventId:       anomaly.eventId,
      correlationId: anomaly.correlationId,
      ...anomaly.details,
    });
  }
}

// ============================================================================
// 4.  Core observation function
// ============================================================================

/**
 * Wraps a single dispatcher call with observability and safety checks.
 *
 * In production: equivalent to calling applyEvent directly (zero overhead).
 * In dev/test: performs purity, determinism, and performance checks.
 */
export function observeDispatch(
  state: BoardStoreState,
  envelope: ClientEventEnvelope,
  context: ReducerContext,
): ObserveResult {
  const eventType     = envelope.event.type;
  const eventId       = envelope.event.id;
  const correlationId = envelope.event.correlationId;

  // ── Fast path: production mode, all checks disabled ───────────────────────
  if (!_config.purityCheck && !_config.determinismCheck && !_config.telemetryEnabled) {
    const start   = performance.now();
    const partial = applyEvent(state, envelope, context);
    const dur     = performance.now() - start;
    return { partial, anomaly: null, durationMs: dur };
  }

  // ── Purity check: snapshot state BEFORE dispatch ──────────────────────────
  let stateBefore: string | null = null;
  if (_config.purityCheck) {
    // Hash the state keys that the reducer might touch.
    // Full structuredClone is too expensive — canonical hash is sufficient.
    stateBefore = canonicalJSON(state);
  }

  // ── Execute reducer ───────────────────────────────────────────────────────
  const start   = performance.now();
  let partial: Partial<BoardStoreState>;
  let anomaly: AnomalyReport | null = null;

  try {
    partial = applyEvent(state, envelope, context);
  } catch (err: any) {
    const dur = performance.now() - start;
    anomaly = {
      kind:          "REDUCER_CRASH",
      eventType,
      eventId,
      correlationId,
      details:       { error: err.message, stack: err.stack?.slice(0, 500) },
      timestamp:     Date.now(),
    };
    recordAnomaly(anomaly);
    return { partial: {}, anomaly, durationMs: dur };
  }

  const durationMs = performance.now() - start;

  // ── Empty return check ────────────────────────────────────────────────────
  if (Object.keys(partial).length === 0 && context.mode === "live") {
    anomaly = {
      kind:          "EMPTY_RETURN",
      eventType,
      eventId,
      correlationId,
      details:       { mode: context.mode },
      timestamp:     Date.now(),
    };
    recordAnomaly(anomaly);
    return { partial, anomaly, durationMs };
  }

  // ── Purity check: state must not have been mutated ────────────────────────
  if (_config.purityCheck && stateBefore !== null) {
    const stateAfter = canonicalJSON(state);
    if (stateAfter !== stateBefore) {
      anomaly = {
        kind:          "STATE_MUTATION_DETECTED",
        eventType,
        eventId,
        correlationId,
        details:       { message: "Reducer mutated input state — purity violation" },
        timestamp:     Date.now(),
      };
      recordAnomaly(anomaly);
      return { partial, anomaly, durationMs };
    }
  }

  // ── Slow reducer check ────────────────────────────────────────────────────
  if (durationMs > _config.slowThresholdMs) {
    anomaly = {
      kind:          "SLOW_REDUCER",
      eventType,
      eventId,
      correlationId,
      details:       { durationMs, threshold: _config.slowThresholdMs },
      timestamp:     Date.now(),
    };
    recordAnomaly(anomaly);
    return { partial, anomaly, durationMs };
  }

  // ── Determinism check: apply same event twice, compare outputs ────────────
  if (_config.determinismCheck) {
    const partial2 = applyEvent(state, envelope, context);
    const hash1    = canonicalJSON(partial);
    const hash2    = canonicalJSON(partial2);

    if (hash1 !== hash2) {
      anomaly = {
        kind:          "NON_DETERMINISTIC",
        eventType,
        eventId,
        correlationId,
        details:       { message: "Two applications of the same event produced different results" },
        timestamp:     Date.now(),
      };
      recordAnomaly(anomaly);
      return { partial, anomaly, durationMs };
    }
  }

  // ── Telemetry log (dev only) ──────────────────────────────────────────────
  if (_config.telemetryEnabled) {
    telemetry.log("STORE", "DISPATCH_OBSERVED", {
      eventType,
      eventId,
      durationMs: Math.round(durationMs * 100) / 100,
      keysChanged: Object.keys(partial).length,
    });
  }

  return { partial, anomaly: null, durationMs };
}

// ============================================================================
// 5.  Batch observation — for replay validation
// ============================================================================

export interface BatchObserveResult {
  readonly anomalies: readonly AnomalyReport[];
  readonly totalEvents: number;
  readonly cleanCount: number;
  readonly totalDurationMs: number;
  readonly avgDurationMs: number;
  readonly maxDurationMs: number;
}

/**
 * Observes an entire replay pass, collecting all anomalies.
 * Does NOT modify the store — operates on a cloned state.
 *
 * Useful in CI for validating reducer purity across a full event stream.
 */
export function batchObserve(
  initialState: BoardStoreState,
  envelopes: readonly ClientEventEnvelope[],
  context: ReducerContext,
): BatchObserveResult {
  let state = structuredClone(initialState);
  const anomalies: AnomalyReport[] = [];
  let cleanCount     = 0;
  let totalDuration  = 0;
  let maxDuration    = 0;

  for (const envelope of envelopes) {
    const result = observeDispatch(state, envelope, context);

    totalDuration += result.durationMs;
    if (result.durationMs > maxDuration) maxDuration = result.durationMs;

    if (result.anomaly) {
      anomalies.push(result.anomaly);
    } else {
      cleanCount++;
    }

    // Apply the partial to advance state for next event.
    if (Object.keys(result.partial).length > 0) {
      state = { ...state, ...result.partial };
    }
  }

  return {
    anomalies,
    totalEvents:    envelopes.length,
    cleanCount,
    totalDurationMs: totalDuration,
    avgDurationMs:   envelopes.length > 0 ? totalDuration / envelopes.length : 0,
    maxDurationMs:   maxDuration,
  };
}
