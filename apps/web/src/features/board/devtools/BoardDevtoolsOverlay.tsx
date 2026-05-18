"use client";
import React, { useState } from "react";
import { useDebugStore } from "./debugStore";
import { useBoardStore } from "../store/useBoardStore";

export function BoardDevtoolsOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  
  // خواندن مستقیم از Telemetry Store
  const logs = useDebugStore((state) => state.logs);
  const mutationTraces = useDebugStore((state) => state.mutationTraces);
  const clearTelemetry = useDebugStore((state) => state.clearTelemetry);

  // خواندن وضعیت حیاتی از Store اصلی
  const syncStatus = useBoardStore((state) => state.syncStatus);
  const boardSequence = useBoardStore((state) => state.boardSequence);

  // فقط میوتیشن‌هایی که هنوز کامل نشده‌اند (Pending/Optimistic) یا اخیراً Fail شده‌اند
  const activeMutations = Object.values(mutationTraces).filter(
    (trace) => trace.currentState !== "ACKED" && trace.currentState !== "GC_REMOVED"
  );

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-50 rounded bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300 shadow border border-slate-700 hover:bg-slate-800"
      >
        📡 System Radar {activeMutations.length > 0 && `(${activeMutations.length} Pending)`}
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 flex h-[600px] w-[500px] flex-col rounded-md border border-slate-700 bg-slate-950 text-slate-300 shadow-2xl font-mono text-[11px] opacity-95">
      
      {/* 🌟 Header */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 p-2">
        <div className="flex gap-4">
          <span className="font-bold text-white">Observability</span>
          <span className={`px-1.5 rounded ${syncStatus === 'healthy' ? 'bg-emerald-900 text-emerald-400' : 'bg-red-900 text-red-400'}`}>
            {syncStatus.toUpperCase()}
          </span>
          <span className="text-slate-400">SEQ: {boardSequence}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={clearTelemetry} className="text-slate-500 hover:text-white">Clear</button>
          <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-white">Close</button>
        </div>
      </div>

      {/* 🌟 Section 1: Pending Mutations (Correlation Tracing) */}
      <div className="border-b border-slate-800 p-2 max-h-[150px] overflow-y-auto">
        <h3 className="mb-1 text-slate-500 uppercase font-bold text-[9px]">Active Mutations</h3>
        {activeMutations.length === 0 ? (
          <div className="text-slate-600">No pending mutations</div>
        ) : (
          <div className="flex flex-col gap-1">
            {activeMutations.map((trace) => (
              <div key={trace.correlationId} className="flex items-center justify-between bg-slate-900 p-1 rounded">
                <span className="text-blue-400 truncate w-24" title={trace.correlationId}>
                  {trace.correlationId.split('-')[0]}...
                </span>
                <span className="text-slate-300">{trace.mutationType}</span>
                <span className={`text-[9px] px-1 rounded ${
                  trace.currentState === 'OPTIMISTIC_APPLIED' ? 'bg-amber-900 text-amber-400' :
                  trace.currentState === 'ROLLBACK_STARTED' ? 'bg-red-900 text-red-400' :
                  'bg-slate-800 text-slate-400'
                }`}>
                  {trace.currentState}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 🌟 Section 2: Structured Logs & Timeline */}
      <div className="flex-1 overflow-y-auto p-2 bg-[#0B1120]">
        <h3 className="mb-2 text-slate-500 uppercase font-bold text-[9px] sticky top-0 bg-[#0B1120]">Telemetry Stream</h3>
        <div className="flex flex-col gap-2">
          {logs.map((log) => (
            <div key={log.id} className="border-l-2 border-slate-700 pl-2">
              <div className="flex justify-between items-start">
                <div className="flex gap-2 text-slate-500">
                  <span>{new Date(log.timestamp).toISOString().substring(11, 23)}</span>
                  <span className="text-amber-500/70">[{log.source}]</span>
                  <span className="text-slate-200 font-bold">{log.action}</span>
                </div>
                {/* نمایش Sequence یا CorrelationId در صورت وجود */}
                <div className="text-[9px] text-slate-600">
                  {log.correlationId && `corr:${log.correlationId.split('-')[0]}`}
                  {log.sequence && ` | seq:${log.sequence}`}
                </div>
              </div>
              
              {/* نمایش دیتای ساختاریافته به صورت JSON */}
              <pre className="mt-1 text-[10px] text-slate-400 overflow-x-auto">
                {JSON.stringify(log.data, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}