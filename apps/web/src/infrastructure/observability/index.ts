// apps/web/src/infrastructure/observability/index.ts
//
// ─── Barrel export for the Observability infrastructure ──────────────────────

// ── Tracer ───────────────────────────────────────────────────────────────────
export { tracer, Tracer, serializeTraceParent, parseTraceParent } from "./tracer";
export type { TraceContext, Span, SpanEvent, SpanStatus, TracerConfig, ExportableSpan } from "./tracer";

// ── Logger ───────────────────────────────────────────────────────────────────
export { logger, Logger } from "./logging";
export type { LogEvent, LogLevel, LogSource, LogOutcome, LoggerConfig, LogContext } from "./logging";

// ── Metrics ──────────────────────────────────────────────────────────────────
export {
  metrics, MetricsRegistry,
  wsConnections, wsReconnects, wsRtt,
  outboxPending, outboxRetries, outboxDlq, mutationRollbacks,
  replayLatency, replayGaps,
  eventsProcessed, eventsDropped,
  reducerDuration, reducerCrashes,
} from "./metrics";
export type { MetricEntry, MetricsConfig } from "./metrics";

// ── Alerts ───────────────────────────────────────────────────────────────────
export { alertManager, AlertManager } from "./alerts";
export type { AlertRule, Alert, AlertSeverity, AlertStatus, AlertsConfig } from "./alerts";

// ── Audit ────────────────────────────────────────────────────────────────────
export { audit, AuditTrail } from "./audit";
export type { AuditEntry, AuditCategory, AuditConfig } from "./audit";
