// apps/web/src/features/board/store/sync/finalization/mutationFinalizer.ts
// ─────────────────────────────────────────────────────────────────────────────
// MutationFinalizer — coordinates ACK ledger + lifecycle manager + outbox.
//
// Finalization states (superset of MutationLifecycleManager statuses):
//   PENDING      → sent to server, awaiting ACK
//   SENT         → in-flight right now
//   ACKED        → server confirmed (idempotency window)
//   FINALIZED    → all side-effects applied, removed from active tracking
//   ROLLED_BACK  → server rejected, snapshot restored
//   DLQ          → poison mutation, requires manual intervention
//
// Causal ordering guarantee:
//   mutations are finalized in the order their ACKs arrive via the WS sequence.
//   An out-of-order ACK (seq < current) is still idempotent but does not advance
//   the watermark, preserving causal consistency.
//
// Idempotent retry cancellation:
//   When an ACK arrives, any scheduled retry for that correlationId is cancelled
//   immediately via the DurableOutbox.
// ─────────────────────────────────────────────────────────────────────────────

import type { AckLedger }              from "./ackLedger";
import type { MutationLifecycleManager } from "../mutationLifecycleManager";
import type { DurableOutbox }           from "../outbox/durableOutbox";

export interface FinalizationObserver {
  onFinalized(correlationId: string, serverSequence: string): void;
  onRolledBack(correlationId: string, reason: string): void;
  onDlq(correlationId: string, reason: string): void;
}

export class MutationFinalizer {
  private observers = new Set<FinalizationObserver>();

  constructor(
    private readonly ledger:   AckLedger,
    private readonly lifecycle: MutationLifecycleManager,
    private readonly outbox:   DurableOutbox,
  ) {}

  // ── Called when the WS event loop receives an ACK for a mutation ──────────

  async finalizeAck(correlationId: string, serverSequence: string): Promise<void> {
    // Idempotency: already finalized
    if (this.ledger.isAcked(correlationId)) return;

    // 1. Record in ledger (durable, survives refresh)
    this.ledger.record(correlationId, serverSequence);

    // 2. ACK in the lifecycle manager
    this.lifecycle.dispatch({ type: "ACK", correlationId, serverSequence });

    // 3. ACK in the durable outbox (cancel any pending retry)
    await this.outbox.ack(correlationId);

    // 4. Notify observers
    for (const obs of this.observers) {
      try { obs.onFinalized(correlationId, serverSequence); } catch { /**/ }
    }
  }

  // ── Called when the server explicitly rejects a mutation ─────────────────

  async finalizeRollback(correlationId: string, reason: string): Promise<void> {
    this.lifecycle.dispatch({
      type: "FAIL",
      correlationId,
      error: { code: "SERVER_REJECTED", message: reason, retryable: false, occurredAt: Date.now() },
    });

    for (const obs of this.observers) {
      try { obs.onRolledBack(correlationId, reason); } catch { /**/ }
    }
  }

  // ── Called when retry budget exhausted (from RetryScheduler / MLM) ───────

  finalizeDlq(correlationId: string, reason: string): void {
    for (const obs of this.observers) {
      try { obs.onDlq(correlationId, reason); } catch { /**/ }
    }
  }

  // ── Causal ordering: check if all mutations before `watermark` are done ──

  hasUnfinalizedBefore(sequence: string): boolean {
    const wm = BigInt(this.ledger.getWatermark());
    const sq = BigInt(sequence);
    if (sq <= wm) return false; // everything up to watermark is confirmed

    // Check if there is any pending mutation with optimistic sequence < sq
    const pending = this.lifecycle.getPending();
    return pending.some((m) => {
      const mv = m.optimisticVersion;
      return mv !== undefined && BigInt(mv) < sq;
    });
  }

  /** Replay-aware: on reconnect, cancel retries for mutations already ACK'd by ledger */
  async reconcileWithLedger(): Promise<void> {
    const pending = this.lifecycle.getPending();
    for (const mut of pending) {
      if (this.ledger.isAcked(mut.correlationId)) {
        // Already ACK'd before (e.g. we crashed after ACK arrived) — finalize now
        this.lifecycle.dispatch({ type: "ACK", correlationId: mut.correlationId });
        await this.outbox.ack(mut.correlationId);
      }
    }
  }

  subscribe(obs: FinalizationObserver): () => void {
    this.observers.add(obs);
    return () => this.observers.delete(obs);
  }
}
