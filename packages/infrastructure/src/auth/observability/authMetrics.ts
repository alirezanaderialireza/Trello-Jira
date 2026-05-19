// packages/infrastructure/src/auth/observability/authMetrics.ts
// ─────────────────────────────────────────────────────────────────────────────
// Auth Metrics — aggregates security signals and publishes to observability pipeline.
//
// Metrics tracked:
//   auth.login.success         count per tenantId + userId
//   auth.login.failure         count per tenantId + reason code
//   auth.token.replay          jti seen more than once
//   auth.session.churn         sessions created/destroyed per minute
//   auth.acl.violation         count per tenantId + resource + permission
//   auth.reconnect.spike       WS reconnect storms per tenantId
//
// Storage: Redis Sorted Sets for time-series windows + pub/sub for streaming.
// ─────────────────────────────────────────────────────────────────────────────

import type { Redis } from "ioredis";

type MetricEventType =
  | "login_success"
  | "login_failure"
  | "token_replay"
  | "session_created"
  | "session_revoked"
  | "acl_violation"
  | "reconnect_spike"
  | "geo_anomaly"
  | "concurrent_sessions_exceeded";

interface MetricEvent {
  type:      MetricEventType;
  tenantId:  string;
  userId?:   string;
  sessionId?: string;
  resource?: string;   // e.g. "board:abc"
  reason?:   string;
  ip?:       string;
  country?:  string;
  value?:    number;
  timestamp: number;
}

const METRIC_CHANNEL = "auth:metrics";
const WINDOW_1MIN_SEC = 60;
const WINDOW_5MIN_SEC = 300;

function windowKey(type: string, tenantId: string, windowSec: number): string {
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  return `auth_metric:${type}:${tenantId}:${bucket}`;
}

export class AuthMetrics {
  constructor(private readonly redis: Redis) {}

  async record(event: Omit<MetricEvent, "timestamp">): Promise<void> {
    const full: MetricEvent = { ...event, timestamp: Date.now() };

    // 1. Increment sliding window counter
    const key1 = windowKey(event.type, event.tenantId, WINDOW_1MIN_SEC);
    const key5 = windowKey(event.type, event.tenantId, WINDOW_5MIN_SEC);
    await Promise.all([
      this.redis.incr(key1).then(() => this.redis.expire(key1, WINDOW_1MIN_SEC * 2)),
      this.redis.incr(key5).then(() => this.redis.expire(key5, WINDOW_5MIN_SEC * 2)),
    ]);

    // 2. Publish to SIEM stream for real-time alerting
    await this.redis.publish(METRIC_CHANNEL, JSON.stringify(full));
  }

  async getWindowCount(type: string, tenantId: string, windowSec = WINDOW_1MIN_SEC): Promise<number> {
    const key = windowKey(type, tenantId, windowSec);
    const v   = await this.redis.get(key);
    return v ? parseInt(v, 10) : 0;
  }

  // Convenience methods
  async loginSuccess(tenantId: string, userId: string): Promise<void> {
    await this.record({ type: "login_success", tenantId, userId });
  }

  async loginFailure(tenantId: string, reason: string, ip?: string): Promise<void> {
    await this.record({ type: "login_failure", tenantId, reason, ip });
  }

  async tokenReplay(tenantId: string, userId: string, jti: string): Promise<void> {
    await this.record({ type: "token_replay", tenantId, userId, reason: jti });
  }

  async aclViolation(tenantId: string, userId: string, resource: string): Promise<void> {
    await this.record({ type: "acl_violation", tenantId, userId, resource });
  }

  async reconnectSpike(tenantId: string, userId: string, count: number): Promise<void> {
    await this.record({ type: "reconnect_spike", tenantId, userId, value: count });
  }
}
