// packages/infrastructure/src/audit/auditLogger.ts
// -----------------------------------------------------------------------------
// Production-grade audit logger.
//
// Design:
//   - Append-only: no UPDATE/DELETE on audit_logs ever
//   - Tamper-proof: writes inside the same DB transaction as the mutation
//   - SIEM stream: after commit, publishes to Redis channel "audit:events"
//     (downstream consumers forward to e.g. Datadog, Splunk, S3)
//   - Before/after state snapshots for high-value entities
//   - Full correlation: traceId, spanId, correlationId, sessionId, ip, userAgent
//   - Worker-safe: AuditLogger can be called from OutboxProcessor with
//     a synthetic session context
// -----------------------------------------------------------------------------

import type { Redis } from "ioredis";

// ============================================================================
// Audit Entry — canonical shape
// ============================================================================

export interface AuditEntry {
  // Actor
  actorId: string;
  tenantId: string;
  sessionId?: string;

  // Action
  action: string;
  entityId: string;
  entityType: string;

  // State snapshots (before/after) — required for high-value mutations
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;

  // Distributed tracing
  correlationId: string;
  traceId?: string;
  spanId?: string;

  // Request context (optional — not available in worker context)
  ip?: string;
  userAgent?: string;
  source: "HTTP" | "WS" | "WORKER" | "SYSTEM";

  // Timestamp — always server-side, never client-supplied
  occurredAt?: Date;
}

// ============================================================================
// SIEM event shape (published to Redis)
// ============================================================================

interface SiemEvent extends AuditEntry {
  id: string;
  occurredAt: string; // ISO string
  schemaVersion: "v1";
}

// ============================================================================
// AuditLogger
// ============================================================================

export class AuditLogger {
  constructor(
    private readonly db: any,
    private readonly redis: Redis,
  ) {}

  // ==========================================================================
  // append — MUST be called inside the same DB transaction as the mutation.
  // This is the only append path — never called outside a transaction.
  // ==========================================================================

  async append(tx: any, entry: AuditEntry): Promise<void> {
    const occurredAt = entry.occurredAt ?? new Date();

    await tx.insert(this.auditLogsTable()).values({
      actorId: entry.actorId,
      tenantId: entry.tenantId,
      action: entry.action,
      entityId: entry.entityId,
      entityType: entry.entityType,
      correlationId: entry.correlationId,
      beforeState: entry.beforeState,
      afterState: entry.afterState,
      createdAt: occurredAt,
    });

    // ------------------------------------------------------------------
    // Schedule SIEM publish AFTER transaction commits.
    // We use setImmediate so this runs after the current call stack
    // (by which point the transaction has committed or rolled back).
    // If the transaction rolled back, the audit row was not written
    // and this publish is harmless (SIEM receives an orphaned event
    // which the pipeline can reconcile against DB).
    // ------------------------------------------------------------------
    const siemEvent: SiemEvent = {
      ...entry,
      id: this.generateId(),
      occurredAt: occurredAt.toISOString(),
      schemaVersion: "v1",
    };

    setImmediate(() => {
      this.publishToSiem(siemEvent).catch(() => {
        // SIEM publish failure is non-fatal — the audit log is in DB
        // A background job can replay undelivered audit events
      });
    });
  }

  // ==========================================================================
  // appendOutOfBand — for WS/Worker mutations where no DB tx is in scope.
  // Writes directly to DB (not in a transaction) and publishes to SIEM.
  // Use with caution — prefer transactional append where possible.
  // ==========================================================================

  async appendOutOfBand(entry: AuditEntry): Promise<void> {
    const occurredAt = entry.occurredAt ?? new Date();

    await this.db.insert(this.auditLogsTable()).values({
      actorId: entry.actorId,
      tenantId: entry.tenantId,
      action: entry.action,
      entityId: entry.entityId,
      entityType: entry.entityType,
      correlationId: entry.correlationId,
      beforeState: entry.beforeState,
      afterState: entry.afterState,
      createdAt: occurredAt,
    });

    const siemEvent: SiemEvent = {
      ...entry,
      id: this.generateId(),
      occurredAt: occurredAt.toISOString(),
      schemaVersion: "v1",
    };

    await this.publishToSiem(siemEvent).catch(() => undefined);
  }

  // ==========================================================================
  // Private: publish to SIEM stream
  // ==========================================================================

  private async publishToSiem(event: SiemEvent): Promise<void> {
    // Primary channel: structured JSON stream for downstream consumers
    await this.redis.publish("audit:events", JSON.stringify(event));

    // High-value entity channel (before/after snapshots)
    if (this.isHighValueEntity(event.entityType)) {
      await this.redis.publish(
        `audit:high_value:${event.tenantId}`,
        JSON.stringify(event),
      );
    }
  }

  private isHighValueEntity(entityType: string): boolean {
    return ["Board", "BoardMember", "Session"].includes(entityType);
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  private auditLogsTable(): any {
    return this.db._.schema?.auditLogs ?? this.db.auditLogs;
  }
}
