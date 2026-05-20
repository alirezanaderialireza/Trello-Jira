import { create } from "zustand";

// ============================================================================
// 🛡️ Structured Types
// ============================================================================

export type LogSource = 
  | "WS_INGRESS" 
  | "RECONCILER" 
  | "MUTATION_ENGINE" 
  | "SNAPSHOT_MANAGER" 
  | "STORE"
  // ── Phase 3: Collaboration ─────────────────────────────────────────────
  | "PRESENCE"
  | "TYPING"
  | "CURSOR"
  | "SELECTION"
  | "AWARENESS"
  | "MUTATION_ACK";

export type MutationLifecycleState = 
  | "CREATED"
  | "OPTIMISTIC_APPLIED"
  | "ACKED"
  | "ROLLBACK_STARTED"
  | "ROLLBACK_FINISHED"
  | "FAILED"
  | "GC_REMOVED";

export interface StructuredLog {
  id: string;
  timestamp: number;
  source: LogSource;
  action: string;           // مثلا: "ROLLBACK_SKIPPED"
  correlationId?: string;   // 🌟 کلید طلایی دیباگ
  sequence?: string;
  eventType?: string;
  data: Record<string, any>; // دیتای ساختاریافته برای بررسی دقیق
}

export interface MutationTrace {
  correlationId: string;
  mutationType: string;
  currentState: MutationLifecycleState;
  createdAt: number;
  updatedAt: number;
  history: { state: MutationLifecycleState; timestamp: number }[];
}

// ============================================================================
// 🧠 Telemetry State
// ============================================================================

interface DebugStoreState {
  logs: StructuredLog[];
  timeline: StructuredLog[];
  mutationTraces: Record<string, MutationTrace>;
  
  addLog: (log: Omit<StructuredLog, "id" | "timestamp">) => void;
  addTimelineEvent: (event: Omit<StructuredLog, "id" | "timestamp">) => void;
  trackMutation: (correlationId: string, type: string, state: MutationLifecycleState) => void;
  clearTelemetry: () => void;
}

const MAX_BUFFER_SIZE = 150; // 🌟 STEP 3: Circular Buffer Size

export const useDebugStore = create<DebugStoreState>((set) => ({
  logs: [],
  timeline: [],
  mutationTraces: {},

  addLog: (payload) => set((state) => {
    const newLog: StructuredLog = { ...payload, id: crypto.randomUUID(), timestamp: Date.now() };
    return { logs: [newLog, ...state.logs].slice(0, MAX_BUFFER_SIZE) };
  }),

  addTimelineEvent: (payload) => set((state) => {
    const newEvent: StructuredLog = { ...payload, id: crypto.randomUUID(), timestamp: Date.now() };
    return { timeline: [newEvent, ...state.timeline].slice(0, MAX_BUFFER_SIZE) };
  }),

  trackMutation: (correlationId, type, lifecycleState) => set((state) => {
    const now = Date.now();
    const existingTrace = state.mutationTraces[correlationId];

    const updatedTrace: MutationTrace = existingTrace 
      ? {
          ...existingTrace,
          currentState: lifecycleState,
          updatedAt: now,
          history: [...existingTrace.history, { state: lifecycleState, timestamp: now }]
        }
      : {
          correlationId,
          mutationType: type,
          currentState: lifecycleState,
          createdAt: now,
          updatedAt: now,
          history: [{ state: lifecycleState, timestamp: now }]
        };

    return {
      mutationTraces: { ...state.mutationTraces, [correlationId]: updatedTrace }
    };
  }),

  clearTelemetry: () => set({ logs: [], timeline: [], mutationTraces: {} }),
}));