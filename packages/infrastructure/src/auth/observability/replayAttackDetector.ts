// packages/infrastructure/src/auth/observability/replayAttackDetector.ts
// ─────────────────────────────────────────────────────────────────────────────
// Replay Attack Detector — detects JTI reuse and token replay attempts.
//
// A replay attack occurs when an attacker captures a valid JWT and submits it
// again after expiry or after the user has logged out.
//
// Detection strategy:
//   - On every token verification, the JTI is checked against a Redis bloom-
//     filter-style set of "seen JTIs" (with TTL = token TTL + clock-skew).
//   - First occurrence → allow + record.
//   - Second occurrence → REPLAY DETECTED → block + alert.
//
// The JTI is already stored as a revoked_token row on logout (from TokenService).
// This detector adds a lightweight hot-path check using a Redis sorted set keyed
// by expiry, enabling efficient TTL-based eviction without a DB read.
// ─────────────────────────────────────────────────────────────────────────────

import type { Redis } from "ioredis";
import type { AuthMetrics } from "./authMetrics";

const JTI_SEEN_KEY    = (tenantId: string) => `auth:jti_seen:${tenantId}`;
const CLOCK_SKEW_SEC  = 60; // allow 60s of clock skew

export class ReplayAttackDetector {
  constructor(
    private readonly redis:   Redis,
    private readonly metrics: AuthMetrics,
  ) {}

  /**
   * Check and record a JTI use.
   * Returns true if this is a replay (seen before with same JTI + still in window).
   */
  async detectAndRecord(params: {
    jti:      string;
    tenantId: string;
    userId:   string;
    tokenExp: number;  // unix timestamp (exp claim)
  }): Promise<boolean> {
    const { jti, tenantId, userId, tokenExp } = params;
    const key     = JTI_SEEN_KEY(tenantId);
    const now     = Date.now() / 1000;
    const ttlSec  = Math.max(1, Math.ceil(tokenExp - now) + CLOCK_SKEW_SEC);

    // ZADD NX: add only if not exists; score = expiry for TTL-based cleanup
    const added = await this.redis.zadd(key, "NX", tokenExp + CLOCK_SKEW_SEC, jti);

    // If added = 0 → key already existed (replay!)
    if (added === 0) {
      await this.metrics.tokenReplay(tenantId, userId, jti);
      return true; // REPLAY DETECTED
    }

    // Expire the entire set after a day (cleanup)
    await this.redis.expire(key, 86_400);

    // Opportunistic cleanup: remove expired JTIs from the sorted set
    if (Math.random() < 0.01) {
      await this.redis.zremrangebyscore(key, "-inf", now);
    }

    return false;
  }

  /** Purge all seen JTIs for a tenant (e.g. on logout all) */
  async purge(tenantId: string): Promise<void> {
    await this.redis.del(JTI_SEEN_KEY(tenantId));
  }
}
