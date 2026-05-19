// apps/web/src/features/board/store/mutations/core/useOptimisticMutation.ts
//
// Changes from original:
//   1. Wired to MutationLifecycleManager — every mutation now goes through the
//      explicit lifecycle: ENQUEUE → SEND → ACK | FAIL → retry/rollback/DLQ
//   2. Removed parallel pendingMutations + lifecycle manager dual tracking:
//      useBoardStore.pendingMutations is STILL updated (for reconciler ACK),
//      but the lifecycle manager is the authoritative status tracker.
//   3. onError auto-triggers FAIL lifecycle event (retryable=false for HTTP 4xx,
//      retryable=true for network errors)

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBoardStore, type BoardStoreState } from "../../useBoardStore";
import { createSnapshot, type SnapshotTarget } from "./createSnapshot";
import type { ClientEventEnvelope } from "../../event-application/types";
import {
  getMutationLifecycleManager,
  type MutationError,
} from "../../sync/mutationLifecycleManager";

// ============================================================================
// Types
// ============================================================================

export interface OptimisticMutationConfig<
  TVariables extends { correlationId: string },
  TData,
> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  queryKeyToCancel?: unknown[];
  targetSnapshot: (variables: TVariables, state: BoardStoreState) => SnapshotTarget;
  generateEnvelope: (
    variables: TVariables,
    state: BoardStoreState,
  ) => ClientEventEnvelope | null;
  successMessage?: string;
  errorMessage?: string;
  /** Max retries before DLQ (default: 3) */
  maxRetries?: number;
}

// ============================================================================
// Optimistic Engine
// ============================================================================

export function useOptimisticMutation<
  TVariables extends { correlationId: string },
  TData,
>(config: OptimisticMutationConfig<TVariables, TData>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: config.mutationFn,

    // ──────────────────────────────────────────────────────────────────────
    // 1. ON MUTATE
    // ──────────────────────────────────────────────────────────────────────
    onMutate: async (variables) => {
      if (config.queryKeyToCancel) {
        await queryClient.cancelQueries({ queryKey: config.queryKeyToCancel });
      }

      const store = useBoardStore.getState();
      const target = config.targetSnapshot(variables, store);
      const snapshot = createSnapshot(store, target);
      const envelope = config.generateEnvelope(variables, store);

      if (envelope) {
        // Register in useBoardStore.pendingMutations (for reconciler ACK)
        store.registerPendingMutation({
          correlationId: variables.correlationId,
          type: envelope.event.type,
          createdAt: Date.now(),
          aggregateId: envelope.event.aggregateId,
          rollbackSnapshot: snapshot,
          retryCount: 0,
          status: "pending",
          optimisticVersion: envelope.event.version,
        });

        // ✅ NEW: Register in MutationLifecycleManager
        const mlm = getMutationLifecycleManager();
        mlm.dispatch({
          type: "ENQUEUE",
          correlationId: variables.correlationId,
          eventType: envelope.event.type,
          aggregateId: envelope.event.aggregateId,
          snapshot,
          optimisticVersion: envelope.event.version,
          maxRetries: config.maxRetries ?? 3,
        });
        mlm.dispatch({ type: "SEND", correlationId: variables.correlationId });

        // Apply optimistic event to UI
        store.applyEvent(envelope, { mode: "live" });
      }

      return { snapshot, correlationId: variables.correlationId };
    },

    // ──────────────────────────────────────────────────────────────────────
    // 2. ON ERROR
    // ──────────────────────────────────────────────────────────────────────
    onError: (err: any, variables, context) => {
      console.error(`[OptimisticEngine] Mutation failed for ${variables.correlationId}`, err);

      const store = useBoardStore.getState();
      const mlm = getMutationLifecycleManager();

      // Classify error retryability
      const isNetworkError =
        err?.name === "TypeError" ||
        err?.message?.includes("fetch") ||
        err?.message?.includes("network");
      const is4xx =
        (err?.data?.httpStatus ?? err?.status) >= 400 &&
        (err?.data?.httpStatus ?? err?.status) < 500;

      const mutationError: MutationError = {
        code: err?.data?.code ?? err?.code ?? "MUTATION_FAILED",
        message: err?.message ?? "Mutation failed",
        retryable: isNetworkError && !is4xx,
        occurredAt: Date.now(),
      };

      if (context?.correlationId) {
        store.updatePendingMutationStatus(context.correlationId, "failed");

        // Signal lifecycle manager — it will auto-retry or rollback
        mlm.dispatch({
          type: "FAIL",
          correlationId: context.correlationId,
          error: mutationError,
        });

        // Rollback is handled by MutationLifecycleManager via onRollback
        // callback wired in useSyncOrchestrator. But also apply directly
        // here as a safety net for cases where orchestrator isn't mounted.
        if (context.snapshot && !mlm.get(context.correlationId)?.rollbackSnapshot) {
          store.restoreSnapshot(context.snapshot);
        }
      }

      toast.error(config.errorMessage ?? "Operation failed. Changes rolled back.", {
        description: "Check your internet connection.",
      });
    },

    // ──────────────────────────────────────────────────────────────────────
    // 3. ON SUCCESS
    // ──────────────────────────────────────────────────────────────────────
    onSuccess: (data, variables) => {
      const store = useBoardStore.getState();
      const mlm = getMutationLifecycleManager();

      // Mark as acked in store (reconciler will also ACK via WS)
      store.updatePendingMutationStatus(variables.correlationId, "acked");

      // Signal lifecycle manager
      mlm.dispatch({ type: "ACK", correlationId: variables.correlationId });

      if (config.successMessage) {
        toast.success(config.successMessage);
      }
    },

    onSettled: () => {
      // No-op: we rely on WS events for final state reconciliation
    },
  });
}
