import { Redis } from "ioredis";
import type { 
  TransactionManager as ITransactionManager, 
  Logger, 
  LogPayload, 
  AggregateLockManager 
} from "@repo/domain";

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
// 🚦 5. Redis Rate Limiter
// ============================================================================
export class RedisRateLimiter {
  constructor(private readonly redis: Redis) {}

  async consume(opts: { key: string; windowMs: number; max: number }): Promise<boolean> {
    const current = await this.redis.incr(opts.key);
    if (current === 1) {
      await this.redis.pexpire(opts.key, opts.windowMs);
    }
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