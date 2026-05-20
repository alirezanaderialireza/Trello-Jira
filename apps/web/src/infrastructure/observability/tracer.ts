// apps/web/src/infrastructure/observability/tracer.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Provides a lightweight, production-ready distributed tracing façade that:
//
//   1. Generates and propagates traceId / spanId / parentId across the entire
//      mutation lifecycle: client → WS → server → worker → projection.
//
//   2. Implements W3C Trace Context propagation format so that if a real
//      OpenTelemetry backend is connected, the traces link seamlessly.
//
//   3. Works standalone (no mandatory backend) — traces are buffered locally
//      and can be exported via flush() to any OTLP-compatible endpoint.
//
//   4. Integrates with BroadcastChannel for multi-tab trace continuity.
//
//   5. Zero-overhead in production when tracing is disabled (early return).
//
// ─── Design ──────────────────────────────────────────────────────────────────
//   • No external dependency (no @opentelemetry/sdk-trace-web import).
//   • Implements the core subset: trace context creation, span lifecycle,
//     context propagation via W3C traceparent header format.
//   • Exportable to OTLP/JSON via flush().
//   • Injectable transport for testing.
// ─────────────────────────────────────────────────────────────────────────────

// ============================================================================
// 1.  Types
// ============================================================================

export interface TraceContext {
  readonly traceId: string;   // 32-char hex (128-bit)
  readonly spanId: string;    // 16-char hex (64-bit)
  readonly parentSpanId?: string;
  readonly traceFlags: number; // 0 = not sampled, 1 = sampled
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startTime: number; // performance.now()
  endTime?: number;
  readonly attributes: Record<string, string | number | boolean>;
  readonly events: SpanEvent[];
  status: SpanStatus;
}

export interface SpanEvent {
  readonly name: string;
  readonly timestamp: number;
  readonly attributes?: Record<string, string | number | boolean>;
}

export type SpanStatus = "OK" | "ERROR" | "UNSET";

/** OTLP-compatible export format (simplified). */
export interface ExportableSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean } }>;
  events: Array<{ name: string; timeUnixNano: string; attributes?: ExportableSpan["attributes"] }>;
  status: { code: number; message?: string };
}

export interface TracerConfig {
  /** Service name for this trace source. */
  serviceName: string;
  /** Whether tracing is enabled. Default: true in development. */
  enabled: boolean;
  /** Sampling rate 0-1. Default: 1.0 (all traces). */
  sampleRate: number;
  /** Max buffered spans before auto-flush. Default: 200. */
  maxBufferSize: number;
  /** Optional OTLP endpoint for export. */
  exportEndpoint?: string;
  /** Optional custom transport for testing. */
  exportFn?: (spans: ExportableSpan[]) => Promise<void>;
}

const DEFAULT_CONFIG: TracerConfig = {
  serviceName: "kiro-web",
  enabled: process.env.NODE_ENV !== "production" || !!process.env.NEXT_PUBLIC_OTEL_ENABLED,
  sampleRate: 1.0,
  maxBufferSize: 200,
};

// ============================================================================
// 2.  ID generation (crypto-safe hex)
// ============================================================================

function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================================
// 3.  W3C Trace Context parsing / serialization
// ============================================================================

/**
 * Format: `00-{traceId}-{spanId}-{flags}`
 * Example: `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`
 */
export function serializeTraceParent(ctx: TraceContext): string {
  const flags = ctx.traceFlags.toString(16).padStart(2, "0");
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

export function parseTraceParent(header: string): TraceContext | null {
  const parts = header.split("-");
  if (parts.length !== 4 || parts[0] !== "00") return null;
  const [, traceId, spanId, flagsHex] = parts;
  if (!traceId || traceId.length !== 32) return null;
  if (!spanId || spanId.length !== 16) return null;
  const traceFlags = parseInt(flagsHex ?? "00", 16);
  return { traceId, spanId, traceFlags };
}

// ============================================================================
// 4.  Tracer class
// ============================================================================

export class Tracer {
  private config: TracerConfig;
  private buffer: Span[] = [];
  private activeSpans = new Map<string, Span>();
  private channel: BroadcastChannel | null = null;

  constructor(config: Partial<TracerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (typeof BroadcastChannel !== "undefined" && this.config.enabled) {
      this.channel = new BroadcastChannel("kiro:tracing");
    }
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  configure(overrides: Partial<TracerConfig>): void {
    this.config = { ...this.config, ...overrides };
  }

  get isEnabled(): boolean {
    return this.config.enabled;
  }

  // ── Span lifecycle ─────────────────────────────────────────────────────────

  /**
   * Start a new span. Returns the span and its TraceContext.
   * If parentCtx is provided, the span inherits the traceId.
   */
  startSpan(
    name: string,
    attributes: Record<string, string | number | boolean> = {},
    parentCtx?: TraceContext,
  ): { span: Span; context: TraceContext } {
    if (!this.config.enabled) {
      // Return a no-op span that won't be recorded.
      const noop: Span = {
        traceId: "0".repeat(32),
        spanId: "0".repeat(16),
        name,
        startTime: 0,
        attributes: {},
        events: [],
        status: "UNSET",
      };
      return { span: noop, context: { traceId: noop.traceId, spanId: noop.spanId, traceFlags: 0 } };
    }

    // Sampling decision
    if (Math.random() > this.config.sampleRate) {
      const noop: Span = {
        traceId: parentCtx?.traceId ?? generateTraceId(),
        spanId: generateSpanId(),
        parentSpanId: parentCtx?.spanId,
        name,
        startTime: 0,
        attributes: {},
        events: [],
        status: "UNSET",
      };
      return { span: noop, context: { traceId: noop.traceId, spanId: noop.spanId, traceFlags: 0 } };
    }

    const traceId = parentCtx?.traceId ?? generateTraceId();
    const spanId = generateSpanId();

    const span: Span = {
      traceId,
      spanId,
      parentSpanId: parentCtx?.spanId,
      name,
      startTime: performance.now(),
      attributes: { ...attributes, "service.name": this.config.serviceName },
      events: [],
      status: "UNSET",
    };

    this.activeSpans.set(spanId, span);

    const context: TraceContext = { traceId, spanId, parentSpanId: parentCtx?.spanId, traceFlags: 1 };
    return { span, context };
  }

  /** Add an event to an active span. */
  addEvent(span: Span, name: string, attributes?: Record<string, string | number | boolean>): void {
    if (!this.config.enabled || span.startTime === 0) return;
    span.events.push({ name, timestamp: performance.now(), attributes });
  }

  /** Set span attributes after creation. */
  setAttribute(span: Span, key: string, value: string | number | boolean): void {
    if (!this.config.enabled || span.startTime === 0) return;
    (span.attributes as Record<string, string | number | boolean>)[key] = value;
  }

  /** End a span and buffer it for export. */
  endSpan(span: Span, status: SpanStatus = "OK"): void {
    if (!this.config.enabled || span.startTime === 0) return;

    span.endTime = performance.now();
    span.status = status;

    this.activeSpans.delete(span.spanId);
    this.buffer.push(span);

    // Broadcast to other tabs for unified trace view.
    this._broadcastSpan(span);

    // Auto-flush when buffer is full.
    if (this.buffer.length >= this.config.maxBufferSize) {
      this.flush();
    }
  }

  /** End a span with error status. */
  endSpanWithError(span: Span, error: Error | string): void {
    if (!this.config.enabled || span.startTime === 0) return;
    this.addEvent(span, "exception", {
      "exception.type": error instanceof Error ? error.name : "Error",
      "exception.message": error instanceof Error ? error.message : String(error),
    });
    this.endSpan(span, "ERROR");
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  /** Flush all buffered spans to the configured endpoint or exportFn. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const spans = this.buffer.splice(0);
    const exportable = spans.map(this._toExportable);

    if (this.config.exportFn) {
      await this.config.exportFn(exportable);
      return;
    }

    if (this.config.exportEndpoint) {
      try {
        await fetch(this.config.exportEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: exportable }] }] }),
          keepalive: true,
        });
      } catch {
        // Non-fatal — traces are best-effort.
      }
    }
  }

  /** Get all buffered spans (for testing / debugging). */
  getBufferedSpans(): readonly Span[] {
    return this.buffer;
  }

  /** Clear the buffer without exporting. */
  clearBuffer(): void {
    this.buffer.length = 0;
  }

  // ── Context propagation helpers ────────────────────────────────────────────

  /**
   * Create a context from correlationId (used in domain events).
   * This links the trace to the mutation's lifecycle.
   */
  contextFromCorrelationId(correlationId: string): TraceContext {
    // Use the correlationId as a deterministic seed for the traceId
    // so that all spans for the same mutation share a traceId.
    const traceId = correlationId.replace(/-/g, "").slice(0, 32).padEnd(32, "0");
    return {
      traceId,
      spanId: generateSpanId(),
      traceFlags: 1,
    };
  }

  /**
   * Inject trace context into an outbound message (WS, HTTP).
   * Adds `traceparent` header.
   */
  injectContext(ctx: TraceContext, carrier: Record<string, string>): void {
    carrier["traceparent"] = serializeTraceParent(ctx);
  }

  /**
   * Extract trace context from an inbound message.
   */
  extractContext(carrier: Record<string, string>): TraceContext | null {
    const header = carrier["traceparent"];
    if (!header) return null;
    return parseTraceParent(header);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _toExportable(span: Span): ExportableSpan {
    const startNano = String(Math.round(span.startTime * 1_000_000));
    const endNano = String(Math.round((span.endTime ?? span.startTime) * 1_000_000));

    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      startTimeUnixNano: startNano,
      endTimeUnixNano: endNano,
      attributes: Object.entries(span.attributes).map(([key, value]) => ({
        key,
        value: typeof value === "string" ? { stringValue: value }
             : typeof value === "number" ? { intValue: String(value) }
             : { boolValue: value },
      })),
      events: span.events.map(e => ({
        name: e.name,
        timeUnixNano: String(Math.round(e.timestamp * 1_000_000)),
        attributes: e.attributes ? Object.entries(e.attributes).map(([key, value]) => ({
          key,
          value: typeof value === "string" ? { stringValue: value }
               : typeof value === "number" ? { intValue: String(value) }
               : { boolValue: value },
        })) : undefined,
      })),
      status: { code: span.status === "OK" ? 1 : span.status === "ERROR" ? 2 : 0 },
    };
  }

  private _broadcastSpan(span: Span): void {
    try {
      this.channel?.postMessage({ type: "SPAN_ENDED", span });
    } catch { /* channel closed */ }
  }
}

// ============================================================================
// 5.  Singleton instance
// ============================================================================

export const tracer = new Tracer();
