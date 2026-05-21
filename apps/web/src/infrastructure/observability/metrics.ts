// apps/web/src/infrastructure/observability/metrics.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Client-side metrics collection for monitoring system health.
// Provides counter, histogram, and gauge primitives that can be exported
// to Prometheus/Grafana or any metrics aggregation backend.
// ─────────────────────────────────────────────────────────────────────────────

// ============================================================================
// 1.  Types
// ============================================================================

export type MetricType = "counter" | "histogram" | "gauge";

export interface MetricEntry {
  readonly name: string;
  readonly type: MetricType;
  readonly value: number;
  readonly labels: Record<string, string>;
  readonly timestamp: number;
}

export interface MetricsConfig {
  enabled: boolean;
  exportEndpoint?: string;
  exportIntervalMs: number;
  maxBufferSize: number;
  exportFn?: (metrics: MetricEntry[]) => Promise<void>;
}

const DEFAULT_CONFIG: MetricsConfig = {
  enabled: true,
  exportIntervalMs: 30_000,
  maxBufferSize: 500,
};

// ============================================================================
// 2.  Metric primitives
// ============================================================================

class Counter {
  private _value = 0;
  readonly name: string;
  readonly labels: Record<string, string>;

  constructor(name: string, labels: Record<string, string> = {}) {
    this.name = name;
    this.labels = labels;
  }

  inc(amount = 1): void { this._value += amount; }
  get value(): number { return this._value; }
  reset(): void { this._value = 0; }
}

class Gauge {
  private _value = 0;
  readonly name: string;
  readonly labels: Record<string, string>;

  constructor(name: string, labels: Record<string, string> = {}) {
    this.name = name;
    this.labels = labels;
  }

  set(value: number): void { this._value = value; }
  inc(amount = 1): void { this._value += amount; }
  dec(amount = 1): void { this._value -= amount; }
  get value(): number { return this._value; }
}

class Histogram {
  private _values: number[] = [];
  private _sum = 0;
  private _count = 0;
  readonly name: string;
  readonly labels: Record<string, string>;
  readonly buckets: readonly number[];

  constructor(name: string, labels: Record<string, string> = {}, buckets: number[] = [1, 5, 10, 25, 50, 100, 250, 500, 1000]) {
    this.name = name;
    this.labels = labels;
    this.buckets = buckets;
  }

  observe(value: number): void {
    this._values.push(value);
    this._sum += value;
    this._count++;
  }

  get count(): number { return this._count; }
  get sum(): number { return this._sum; }
  get avg(): number { return this._count > 0 ? this._sum / this._count : 0; }
  get p50(): number { return this._percentile(0.5); }
  get p95(): number { return this._percentile(0.95); }
  get p99(): number { return this._percentile(0.99); }

  reset(): void {
    this._values = [];
    this._sum = 0;
    this._count = 0;
  }

  private _percentile(p: number): number {
    if (this._values.length === 0) return 0;
    const sorted = [...this._values].sort((a, b) => a - b);
    const idx = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.max(0, idx)]!;
  }
}

// ============================================================================
// 3.  MetricsRegistry
// ============================================================================

export class MetricsRegistry {
  private config: MetricsConfig;
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();
  private buffer: MetricEntry[] = [];
  private exportTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<MetricsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  init(): void {
    if (!this.config.enabled) return;
    this.exportTimer = setInterval(() => this.flush(), this.config.exportIntervalMs);
  }

  destroy(): void {
    if (this.exportTimer) clearInterval(this.exportTimer);
    this.exportTimer = null;
  }

  // ── Factory methods ────────────────────────────────────────────────────────

  counter(name: string, labels: Record<string, string> = {}): Counter {
    const key = `${name}:${JSON.stringify(labels)}`;
    let c = this.counters.get(key);
    if (!c) { c = new Counter(name, labels); this.counters.set(key, c); }
    return c;
  }

  gauge(name: string, labels: Record<string, string> = {}): Gauge {
    const key = `${name}:${JSON.stringify(labels)}`;
    let g = this.gauges.get(key);
    if (!g) { g = new Gauge(name, labels); this.gauges.set(key, g); }
    return g;
  }

  histogram(name: string, labels: Record<string, string> = {}, buckets?: number[]): Histogram {
    const key = `${name}:${JSON.stringify(labels)}`;
    let h = this.histograms.get(key);
    if (!h) { h = new Histogram(name, labels, buckets); this.histograms.set(key, h); }
    return h;
  }

  // ── Snapshot ───────────────────────────────────────────────────────────────

  snapshot(): MetricEntry[] {
    const now = Date.now();
    const entries: MetricEntry[] = [];

    for (const c of this.counters.values()) {
      entries.push({ name: c.name, type: "counter", value: c.value, labels: c.labels, timestamp: now });
    }
    for (const g of this.gauges.values()) {
      entries.push({ name: g.name, type: "gauge", value: g.value, labels: g.labels, timestamp: now });
    }
    for (const h of this.histograms.values()) {
      entries.push({ name: `${h.name}_count`, type: "histogram", value: h.count, labels: h.labels, timestamp: now });
      entries.push({ name: `${h.name}_sum`, type: "histogram", value: h.sum, labels: h.labels, timestamp: now });
      entries.push({ name: `${h.name}_p95`, type: "histogram", value: h.p95, labels: h.labels, timestamp: now });
    }

    return entries;
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  async flush(): Promise<void> {
    if (!this.config.enabled) return;
    const entries = this.snapshot();
    if (entries.length === 0) return;

    if (this.config.exportFn) {
      await this.config.exportFn(entries);
      return;
    }

    if (this.config.exportEndpoint) {
      try {
        await fetch(this.config.exportEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metrics: entries }),
          keepalive: true,
        });
      } catch { /* best-effort */ }
    }
  }
}

// ============================================================================
// 4.  Pre-defined board metrics (singleton registry)
// ============================================================================

export const metrics = new MetricsRegistry();

// ── WS connection metrics ────────────────────────────────────────────────────
export const wsConnections     = metrics.counter("ws_connections_total");
export const wsReconnects      = metrics.counter("ws_reconnects_total");
export const wsRtt             = metrics.histogram("ws_rtt_ms");

// ── Outbox / Mutation metrics ────────────────────────────────────────────────
export const outboxPending     = metrics.gauge("outbox_pending_mutations");
export const outboxRetries     = metrics.counter("outbox_retries_total");
export const outboxDlq         = metrics.counter("outbox_dlq_total");
export const mutationRollbacks = metrics.counter("mutation_rollbacks_total");

// ── Replay metrics ───────────────────────────────────────────────────────────
export const replayLatency     = metrics.histogram("replay_latency_ms");
export const replayGaps        = metrics.counter("replay_gaps_total");

// ── Event throughput ─────────────────────────────────────────────────────────
export const eventsProcessed   = metrics.counter("events_processed_total");
export const eventsDropped     = metrics.counter("events_dropped_total");

// ── Reducer performance ──────────────────────────────────────────────────────
export const reducerDuration   = metrics.histogram("reducer_duration_ms");
export const reducerCrashes    = metrics.counter("reducer_crashes_total");
