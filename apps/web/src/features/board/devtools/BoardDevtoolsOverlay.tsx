"use client";

import React, { useState, useSyncExternalStore } from "react";
import { useDebugStore } from "@/lib/telemetry/debugStore";
import { useBoardStore } from "../store/useBoardStore";
import { getSyncFSM } from "../store/sync/syncFSMSingleton";
import {
  getMutationLifecycleManager,
} from "../store/sync/mutationLifecycleManager";
import type { SyncState } from "../store/sync/syncStateMachine";

// ============================================================================
// FSM State Hook (external store subscription)
// ============================================================================

function useFSMState(): SyncState {
  return useSyncExternalStore(
    (cb) => {
      const fsm = getSyncFSM();
      return fsm.subscribe(() => cb());
    },
    () => getSyncFSM().getState(),
    () => "idle" as SyncState,
  );
}

// ============================================================================
// Lifecycle Stats Hook
// ============================================================================

function useLifecycleStats() {
  // Re-render whenever mutations change via observer
  const [, setTick] = useState(0);

  React.useEffect(() => {
    const mlm = getMutationLifecycleManager();
    const unsub = mlm.subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  return getMutationLifecycleManager().stats();
}

// ============================================================================
// Color mapping for FSM states
// ============================================================================

const FSM_STATE_COLORS: Record<SyncState, { bg: string; text: string }> = {
  idle:         { bg: "bg-slate-800",   text: "text-slate-400"  },
  synced:       { bg: "bg-emerald-900", text: "text-emerald-400" },
  catching_up:  { bg: "bg-amber-900",   text: "text-amber-400"  },
  resyncing:    { bg: "bg-orange-900",  text: "text-orange-400" },
  reconnecting: { bg: "bg-yellow-900",  text: "text-yellow-300" },
  offline:      { bg: "bg-red-900",     text: "text-red-400"    },
};

// ============================================================================
// Main Overlay
// ============================================================================

export function BoardDevtoolsOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"mutations" | "fsm" | "logs">("mutations");

  // Telemetry
  const logs = useDebugStore((s) => s.logs);
  const mutationTraces = useDebugStore((s) => s.mutationTraces);
  const clearTelemetry = useDebugStore((s) => s.clearTelemetry);

  // Store state
  const boardSequence = useBoardStore((s) => s.boardSequence);
  const pendingMutationsCount = useBoardStore(
    (s) => Object.keys(s.pendingMutations).length,
  );

  // FSM + lifecycle
  const fsmState = useFSMState();
  const lifecycleStats = useLifecycleStats();
  const fsmContext = getSyncFSM().getContext();
  const fsmColors = FSM_STATE_COLORS[fsmState] ?? FSM_STATE_COLORS.idle;

  // Active mutations (non-terminal states)
  const activeMutations = Object.values(mutationTraces).filter(
    (t) => t.currentState !== "ACKED" && t.currentState !== "GC_REMOVED",
  );

  if (!isOpen) {
    const hasPending =
      activeMutations.length > 0 || lifecycleStats.queued + lifecycleStats.sent > 0;
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-50 rounded bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300 shadow border border-slate-700 hover:bg-slate-800"
      >
        📡 Radar {hasPending && `(${lifecycleStats.queued + lifecycleStats.sent})`}
        {" "}
        <span className={`px-1 rounded text-[9px] ${fsmColors.bg} ${fsmColors.text}`}>
          {fsmState.toUpperCase()}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 flex h-[680px] w-[560px] flex-col rounded-md border border-slate-700 bg-slate-950 text-slate-300 shadow-2xl font-mono text-[11px] opacity-97">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 p-2 shrink-0">
        <div className="flex gap-3 items-center">
          <span className="font-bold text-white">Observability</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${fsmColors.bg} ${fsmColors.text}`}>
            {fsmState.toUpperCase()}
          </span>
          <span className="text-slate-400 text-[10px]">SEQ:{boardSequence}</span>
          <span className="text-slate-500 text-[10px]">
            store:{pendingMutationsCount} | mlm:{lifecycleStats.total}
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={clearTelemetry} className="text-slate-500 hover:text-white text-[10px]">
            Clear
          </button>
          <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-white">
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 shrink-0">
        {(["mutations", "fsm", "logs"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
              activeTab === tab
                ? "border-b-2 border-blue-500 text-blue-400"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab: Mutations */}
      {activeTab === "mutations" && (
        <div className="flex-1 overflow-y-auto p-2">
          {/* Lifecycle Manager Stats */}
          <div className="mb-3 grid grid-cols-4 gap-1">
            {(["queued", "sent", "acknowledged", "failed", "retried", "rolledBack", "deadLettered"] as const).map(
              (key) => (
                <div key={key} className="bg-slate-900 rounded p-1.5 text-center">
                  <div className="text-[9px] text-slate-500 uppercase">{key}</div>
                  <div
                    className={`text-sm font-bold ${
                      key === "failed" || key === "deadLettered" || key === "rolledBack"
                        ? lifecycleStats[key] > 0 ? "text-red-400" : "text-slate-400"
                        : key === "acknowledged"
                        ? "text-emerald-400"
                        : "text-slate-200"
                    }`}
                  >
                    {lifecycleStats[key]}
                  </div>
                </div>
              ),
            )}
          </div>

          {/* DLQ Warning */}
          {lifecycleStats.deadLettered > 0 && (
            <div className="mb-2 rounded bg-red-950 border border-red-800 px-2 py-1 text-red-400 text-[10px]">
              ⚠️ {lifecycleStats.deadLettered} mutation(s) in Dead Letter Queue
            </div>
          )}

          {/* Active Mutations from telemetry traces */}
          <h3 className="text-[9px] text-slate-500 uppercase font-bold mb-1">
            Active Mutation Traces
          </h3>
          {activeMutations.length === 0 ? (
            <div className="text-slate-600 text-[10px]">No active mutations</div>
          ) : (
            <div className="flex flex-col gap-1">
              {activeMutations.map((trace) => (
                <div
                  key={trace.correlationId}
                  className="flex items-center justify-between bg-slate-900 p-1.5 rounded"
                >
                  <span className="text-blue-400 truncate w-20 text-[10px]" title={trace.correlationId}>
                    {trace.correlationId.slice(0, 8)}…
                  </span>
                  <span className="text-slate-300 text-[10px]">{trace.mutationType}</span>
                  <span
                    className={`text-[9px] px-1 rounded ${
                      trace.currentState === "OPTIMISTIC_APPLIED"
                        ? "bg-amber-900 text-amber-400"
                        : trace.currentState === "ROLLBACK_STARTED"
                        ? "bg-red-900 text-red-400"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {trace.currentState}
                  </span>
                  <span className="text-slate-600 text-[9px]">
                    {trace.history.length} steps
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: FSM */}
      {activeTab === "fsm" && (
        <div className="flex-1 overflow-y-auto p-2">
          <div className="mb-3">
            <h3 className="text-[9px] text-slate-500 uppercase font-bold mb-2">
              Sync State Machine
            </h3>
            <div className={`rounded p-3 ${fsmColors.bg}`}>
              <div className={`text-lg font-bold ${fsmColors.text}`}>
                {fsmState.toUpperCase()}
              </div>
              <div className="text-slate-400 text-[10px] mt-1">
                Board: {fsmContext.boardId ?? "—"} | seq: {fsmContext.lastSequence}
              </div>
              <div className="text-slate-400 text-[10px]">
                Reconnect attempts: {fsmContext.reconnectAttempts}
              </div>
              {fsmContext.gapStart && (
                <div className="text-amber-400 text-[10px]">
                  Gap: {fsmContext.gapStart} → {fsmContext.gapEnd}
                </div>
              )}
              <div className="text-slate-500 text-[9px] mt-1">
                Leader tab: {fsmContext.isLeaderTab ? "YES" : "NO"} |
                In state since: {new Date(fsmContext.enteredStateAt).toISOString().slice(11, 19)}
              </div>
            </div>
          </div>

          {/* FSM State Diagram (simplified) */}
          <div className="text-[9px] text-slate-500">
            <div className="font-bold uppercase mb-1">State Flow</div>
            <div className="space-y-0.5">
              {(["idle", "reconnecting", "synced", "catching_up", "resyncing", "offline"] as SyncState[]).map(
                (s) => (
                  <div
                    key={s}
                    className={`flex items-center gap-2 px-2 py-1 rounded ${
                      s === fsmState
                        ? `${fsmColors.bg} ${fsmColors.text} font-bold`
                        : "text-slate-600"
                    }`}
                  >
                    <span>{s === fsmState ? "►" : "·"}</span>
                    <span className="uppercase">{s}</span>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Logs */}
      {activeTab === "logs" && (
        <div className="flex-1 overflow-y-auto p-2 bg-[#0B1120]">
          <h3 className="mb-2 text-slate-500 uppercase font-bold text-[9px] sticky top-0 bg-[#0B1120]">
            Telemetry Stream ({logs.length})
          </h3>
          <div className="flex flex-col gap-1.5">
            {logs.map((log) => (
              <div key={log.id} className="border-l-2 border-slate-700 pl-2">
                <div className="flex justify-between items-start">
                  <div className="flex gap-2 text-slate-500">
                    <span className="text-[9px]">
                      {new Date(log.timestamp).toISOString().slice(11, 23)}
                    </span>
                    <span className="text-amber-500/70 text-[9px]">[{log.source}]</span>
                    <span className="text-slate-200 font-bold text-[10px]">{log.action}</span>
                  </div>
                  <div className="text-[9px] text-slate-600">
                    {log.correlationId && `c:${log.correlationId.slice(0, 6)}`}
                    {log.sequence && ` s:${log.sequence}`}
                  </div>
                </div>
                {Object.keys(log.data).length > 0 && (
                  <pre className="mt-0.5 text-[9px] text-slate-400 overflow-x-auto">
                    {JSON.stringify(log.data, null, 1)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
