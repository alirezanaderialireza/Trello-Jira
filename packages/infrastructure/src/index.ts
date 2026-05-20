import { Redis } from "ioredis";
import type { 
  TransactionManager as ITransactionManager, 
  Logger, 
  LogPayload, 
  AggregateLockManager 
} from "@repo/domain";

// Re-export auth, cache, audit, ws modules
export { TokenService, TokenError } from "./auth/tokenService";
export type { TokenPair, AccessTokenClaims, TokenServiceConfig } from "./auth/tokenService";

export { AclEngine, roleAtLeast, hasPermission } from "./auth/aclEngine";
export type { BoardRole, BoardPermission, AclCheckResult } from "./auth/aclEngine";

// Phase 2: Card-level ACL
export { CardAclEngine } from "./auth/cardAclEngine";
export type { CardPermission, CardVisibility, CardAclCheckResult } from "./auth/cardAclEngine";

// Phase 2: Live ACL Invalidation
export { AclInvalidationBus, ACL_INVALIDATION_CHANNEL } from "./auth/liveAcl/aclInvalidationBus";
export type { AclInvalidationEvent, AclInvalidationEventType } from "./auth/liveAcl/aclInvalidationBus";
export { SessionRevoker } from "./auth/liveAcl/sessionRevoker";
export { WsAclEnforcer } from "./auth/liveAcl/wsAclEnforcer";

// Phase 2: Auth Observability
export { AuthMetrics } from "./auth/observability/authMetrics";
export { ReplayAttackDetector } from "./auth/observability/replayAttackDetector";
export { AnomalyDetector } from "./auth/observability/anomalyDetector";
export { computeFingerprint, verifyFingerprint } from "./auth/observability/sessionFingerprint";
export type { FingerprintComponents, FingerprintMismatch, FingerprintResult, RiskLevel } from "./auth/observability/sessionFingerprint";

// Phase 2: Service-to-Service Auth
export { ServiceTokenService, ServiceAuthError } from "./auth/serviceAuth/serviceTokenService";
export type { ServiceName, ServiceTokenClaims, ServiceTokenConfig } from "./auth/serviceAuth/serviceTokenService";
export { ServiceAcl, getServiceAcl } from "./auth/serviceAuth/serviceAcl";
export type { ServiceScope, ServiceRegistration } from "./auth/serviceAuth/serviceAcl";
export { InternalAuthMiddleware } from "./auth/serviceAuth/internalAuthMiddleware";
export type { InternalAuthContext, InternalAuthResult } from "./auth/serviceAuth/internalAuthMiddleware";

export { MembershipCache } from "./redis/membershipCache";
export type { MembershipEntry } from "./redis/membershipCache";

export { AuditLogger } from "./audit/auditLogger";
export type { AuditEntry } from "./audit/auditLogger";

export {
  WsSessionManager,
  WsAuthHandler,
  WsEventEmitter,
  WsAuthError,
  buildWorkerSession,
} from "./ws/wsServer";
export type { WsConnection, WsOutboundEvent, WsInboundMessage, WorkerSession } from "./ws/wsServer";

// ============================================================================
// 📝 1. Structured JSON Logger
// ============================================================================
export class PinoLogger implements Logger {
  info(payload: LogPayload) { 
    console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), ...payload })); 
  }
  warn(payload: LogPayload) { 
    console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), ...payload })); 
  }
  error(payload: LogPayload) { 
    console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), ...payload })); 
  }
  debug(payload: LogPayload) { 
    console.debug(JSON.stringify({ level: 'DEBUG', timestamp: new Date().toISOString(), ...payload })); 
  }
}

// ============================================================================
// ⚡ 2. Drizzle Transaction Manager (Serializable Isolation)
// ============================================================================
export class TransactionManager implements ITransactionManager<any> {
  constructor(private readonly db: any) {}

  async serializable<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    // 🌟 بالاترین سطح ایزولاسیون دیتابیس برای جلوگیری از باگ‌های همزمانی (Race Conditions)
    return await this.db.transaction(
      async (tx: any) => {
        return await callback(tx);
      },
      { isolationLevel: "serializable" }
    );
  }

  isRetryable(error: any): boolean {
    // کد خطای 40001 در Postgres مربوط به Serialization Failure است
    return error?.code === '40001';
  }
}

// ============================================================================
// 🔒 3. Distributed Lock Manager (Deadlock Prevention)
// ============================================================================
export class DistributedLockManager implements AggregateLockManager<any> {
  constructor(private readonly db: any) {}

  async lockAggregates(tx: any, aggregateIds: readonly string[]): Promise<void> {
    if (aggregateIds.length === 0) return;
    
    // در سیستم واقعی، اینجا می‌توان از pg_advisory_xact_lock برای قفل کردن سطح Aggregate استفاده کرد
    // فعلاً چون در Repositoryها از `FOR UPDATE` استفاده کردیم، این متد رو خالی می‌ذاریم
  }
}

// ============================================================================
// 🚀 4. Redis Infrastructure Manager (Storage & PubSub)
// ============================================================================
export class RedisManager {
  public readonly client: Redis;
  public readonly pubsub: Redis;

  constructor(connectionString: string) {
    this.client = new Redis(connectionString, { maxRetriesPerRequest: null });
    this.pubsub = new Redis(connectionString, { maxRetriesPerRequest: null });
  }
}

// ============================================================================
// 🚦 5. Redis Rate Limiter (atomic Lua script — no TOCTOU race)
// ============================================================================
// Previous bug: INCR + PEXPIRE were two separate commands.
// If the process died between them, the key had no TTL → permanent key.
// Fix: atomic Lua script that sets TTL only on first increment.
// ============================================================================

const RATE_LIMIT_LUA = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local current = redis.call('INCR', key)
if current == 1 then
  redis.call('PEXPIRE', key, windowMs)
end
return current
`;

export class RedisRateLimiter {
  constructor(private readonly redis: Redis) {}

  async consume(opts: { key: string; windowMs: number; max: number }): Promise<boolean> {
    // ✅ FIX: atomic Lua script — INCR + PEXPIRE in one round-trip
    const current = await this.redis.eval(
      RATE_LIMIT_LUA,
      1,
      opts.key,
      String(opts.max),
      String(opts.windowMs),
    ) as number;
    return current <= opts.max;
  }
}

// ============================================================================
// ⚡ 6. Redis Presence Store
// ============================================================================
export class RedisPresenceStore {
  constructor(private readonly redis: Redis) {}

  async set(key: string, value: any, ttlMs: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), "PX", ttlMs);
  }

  async get<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async cleanupExpired(): Promise<void> {
    // 🌟 Redis خودش با TTL داده‌های منقضی شده را پاک می‌کند، 
    // اما برای پشتیبانی از Opportunistic Cleanup که در لایه روتر نوشتی، این متد را قرار می‌دهیم.
  }
}

// ============================================================================
// 📡 7. Redis PubSub
// ============================================================================
export class RedisPubSub {
  constructor(private readonly publisher: Redis) {}

  async publish(channel: string, payload: any): Promise<void> {
    await this.publisher.publish(channel, JSON.stringify(payload));
  }
}