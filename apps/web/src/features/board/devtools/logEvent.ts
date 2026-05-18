import { useDebugStore, LogSource, MutationLifecycleState } from "./debugStore";

const isDev = process.env.NODE_ENV === "development";

/**
 * 🛰️ Telemetry Interface
 * این آبجکت در سراسر کدهای اصلی استفاده می‌شود.
 * در پروداکشن تمام این توابع بلااستفاده (No-op) می‌شوند تا پرفورمنس افت نکند.
 */
export const telemetry = {
  log: (
    source: LogSource, 
    action: string, 
    data: Record<string, any>, 
    meta?: { correlationId?: string; sequence?: string; eventType?: string }
  ) => {
    if (!isDev) return;
    useDebugStore.getState().addLog({ source, action, data, ...meta });
  },

  timeline: (
    source: LogSource,
    eventType: string,
    data: Record<string, any>,
    meta?: { correlationId?: string; sequence?: string }
  ) => {
    if (!isDev) return;
    useDebugStore.getState().addTimelineEvent({ 
      source, 
      action: "TIMELINE_EVENT", 
      eventType, 
      data, 
      ...meta 
    });
  },

  mutation: (
    correlationId: string, 
    type: string, 
    state: MutationLifecycleState
  ) => {
    if (!isDev) return;
    useDebugStore.getState().trackMutation(correlationId, type, state);
  }
};