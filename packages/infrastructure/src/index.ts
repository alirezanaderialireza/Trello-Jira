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
export type { FingerprintComponents, FingerprintMismatch, FingerprintResult } from "./auth/observability/sessionFingerprint";
export type { RiskLevel } from "./auth/observability/anomalyDetector";

// Phase 2: Service-to-Service Auth
export { ServiceTokenService, ServiceAuthError } from "./auth/serviceAuth/serviceTokenService";
export type { ServiceName, ServiceTokenClaims, ServiceTokenConfig } from "./auth/serviceAuth/serviceTokenService";
export { ServiceAcl, getServiceAcl } from "./auth/serviceAuth/serviceAcl";
export type { ServiceScope, ServiceRegistration } from "./auth/serviceAuth/serviceAcl";
export { InternalAuthMiddleware } from "./auth/serviceAuth/internalAuthMiddleware";
export type { InternalAuthContext, InternalAuthResult } from "./auth/serviceAuth/internalAuthMiddleware";

export { MembershipCache, MembershipLookupError } from "./redis/membershipCache";
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
//
// `applyTenantContext` is the RLS hook. When the tRPC layer wires this
// constructor (see packages/api/src/trpc.ts), it passes a callback that reads
// the request's tenantId/userId from `tenantContextALS` (defined in
// `@repo/db/middleware/tenantContext`) and runs `SET LOCAL app.current_tenant_id
// = ...` on every transaction this manager opens.
//
// The result: services that use `txManager.serializable(...)` to do their own
// transactional work — which gets a fresh connection from the pool with no
// GUC set — automatically inherit the request's tenant context, so the third
// defence layer (Postgres RLS) keeps fire-ing even for service-driven queries.
//
// The hook is OPTIONAL by design: workers (outbox processor, rebalance worker)
// construct a `TransactionManager` without the hook because they intentionally
// run cross-tenant — they connect with a `BYPASSRLS` role and operate on the
// whole queue. Tests that don't care about RLS likewise omit it.
//
// `applyTenantContext` is a `function | undefined` (not a method) so the
// concrete class still satisfies the bare `TransactionManager<TTx>` port
// from `@repo/domain/ports`.
// ============================================================================
export class TransactionManager implements ITransactionManager<any> {
  constructor(
    private readonly db: any,
    private readonly applyTenantContext?: (tx: any) => Promise<void>,
  ) {}

  async serializable<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    // 🌟 بالاترین سطح ایزولاسیون دیتابیس برای جلوگیری از باگ‌های همزمانی (Race Conditions)
    return await this.db.transaction(
      async (tx: any) => {
        // RLS hook — set tenant/user GUCs before the user callback runs.
        // Anything thrown here surfaces as a normal transaction failure
        // and rolls everything back, which is the correct behaviour: a
        // service tx that cannot establish tenant context MUST fail
        // closed rather than leak rows across tenants.
        if (this.applyTenantContext) {
          await this.applyTenantContext(tx);
        }
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