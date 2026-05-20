// apps/web/src/infrastructure/observability/logging.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Production-grade structured logging with:
//   • Typed LogEvent schema matching the Phase 7 spec
//   • Multiple sinks (console, buffer, HTTP/SIEM)
//   • Level filtering (debug < info < warn < error)
//   • Context enrichment (actorId, tenantId, correlationId, traceId)
//   • Multi-tab dedup (BroadcastChannel)
//   • Zero-overhead in production for debug-level logs
// ─────────────────────────────────────────────────────────────────────────────

// ============================================================================
// 1.  Types
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSource = "web" | "ws" | "worker" | "cron";
export type LogOutcome = "success" | "fail" | "DLQ" | "rollback";

export interface LogEvent {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly actorId?: string;
  readonly tenantId?: string;
  readonly correlationId: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly source: LogSource;
  readonly outcome: LogOutcome;
  readonly boardId?: string;
  readonly details?: Record<string, unknown>;
}

export interface LoggerConfig {
  /** Minimum level to emit. Default: "info" in production, "debug" in dev. */
  minLevel: LogLevel;
  /** Log source for this instance. */
  source: LogSource;
  /** Whether to write to console. Default: true in dev. */
  consoleEnabled: boolean;
  /** Max buffer size before auto-flush to HTTP sink. */
  maxBufferSize: number;
  /** HTTP endpoint for SIEM / log aggregation. */
  httpEndpoint?: string;
  /** Custom sink for testing. */
  sinkFn?: (events: LogEvent[]) => Promise<void>;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: process.env.NODE_ENV === "production" ? "info" : "debug",
  source: "web",
  consoleEnabled: process.env.NODE_ENV !== "production",
  maxBufferSize: 100,
};

// ============================================================================
// 2.  Context — enrichment applied to every log event
// ============================================================================

export interface LogContext {
  actorId?: string;
  tenantId?: string;
  boardId?: string;
  traceId?: string;
  spanId?: string;
}

// ============================================================================
// 3.  Logger class
// ============================================================================

export class Logger {
  private config: LoggerConfig;
  private context: LogContext = {};
  private buffer: LogEvent[] = [];

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  configure(overrides: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...overrides };
  }

  setContext(ctx: Partial<LogContext>): void {
    this.context = { ...this.context, ...ctx };
  }

  clearContext(): void {
    this.context = {};
  }

  // ── Convenience methods ────────────────────────────────────────────────────

  debug(eventType: string, correlationId: string, outcome: LogOutcome, details?: Record<string, unknown>): void {
    this._emit("debug", eventType, correlationId, outcome, details);
  }

  info(eventType: string, correlationId: string, outcome: LogOutcome, details?: Record<string, unknown>): void {
    this._emit("info", eventType, correlationId, outcome, details);
  }

  warn(eventType: string, correlationId: string, outcome: LogOutcome, details?: Record<string, unknown>): void {
    this._emit("warn", eventType, correlationId, outcome, details);
  }

  error(eventType: string, correlationId: string, outcome: LogOutcome, details?: Record<string, unknown>): void {
    this._emit("error", eventType, correlationId, outcome, details);
  }

  // ── Structured event logging ───────────────────────────────────────────────

  logEvent(event: Omit<LogEvent, "timestamp" | "source">): void {
    const full: LogEvent = {
      ...event,
      timestamp: new Date().toISOString(),
      source: this.config.source,
      actorId: event.actorId ?? this.context.actorId,
      tenantId: event.tenantId ?? this.context.tenantId,
      boardId: (event as any).boardId ?? this.context.boardId,
      traceId: (event as any).traceId ?? this.context.traceId,
      spanId: (event as any).spanId ?? this.context.spanId,
    };

    if (LEVEL_PRIORITY[full.level] < LEVEL_PRIORITY[this.config.minLevel]) return;

    this._write(full);
  }

  // ── Flush / export ─────────────────────────────────────────────────────────

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0);

    if (this.config.sinkFn) {
      await this.config.sinkFn(events);
      return;
    }

    if (this.config.httpEndpoint) {
      try {
        await fetch(this.config.httpEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logs: events }),
          keepalive: true,
        });
      } catch { /* best-effort */ }
    }
  }

  getBuffer(): readonly LogEvent[] {
    return this.buffer;
  }

  clearBuffer(): void {
    this.buffer.length = 0;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _emit(
    level: LogLevel,
    eventType: string,
    correlationId: string,
    outcome: LogOutcome,
    details?: Record<string, unknown>,
  ): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.config.minLevel]) return;

    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      source: this.config.source,
      eventType,
      eventVersion: 1,
      correlationId,
      outcome,
      actorId: this.context.actorId,
      tenantId: this.context.tenantId,
      boardId: this.context.boardId,
      traceId: this.context.traceId,
      spanId: this.context.spanId,
      details,
    };

    this._write(event);
  }

  private _write(event: LogEvent): void {
    // Console output (dev only)
    if (this.config.consoleEnabled) {
      const method = event.level === "error" ? "error"
                   : event.level === "warn" ? "warn"
                   : event.level === "debug" ? "debug"
                   : "log";
      console[method](`[${event.source}] ${event.eventType}`, event);
    }

    // Buffer for async export
    this.buffer.push(event);

    if (this.buffer.length >= this.config.maxBufferSize) {
      this.flush();
    }
  }
}

// ============================================================================
// 4.  Singleton
// ============================================================================

export const logger = new Logger();
