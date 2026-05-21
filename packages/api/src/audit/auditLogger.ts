// packages/api/src/audit/auditLogger.ts
//
// ============================================================================
// 📋 AuditLogger — Full Audit Trail for All Mutations
// ============================================================================
//
// Design:
//   Every mutation (card/list/board create/update/delete/move) must produce an
//   audit log entry.  The audit log is:
//     • Append-only — rows are NEVER updated or deleted
//     • Dual-revision aware — records both before/after state
//     • Trace-linked — carries traceId/spanId/correlationId for distributed
//       tracing (Jaeger, DataDog, etc.)
//     • Source-tagged — http | ws | worker
//     • Tenant-isolated — always filtered by tenantId
//
// Integration points:
//   1. tRPC procedures call `AuditLogger.log()` via the existing
//      DrizzleAuditRepository after each successful mutation.
//   2. The WS gateway calls `AuditLogger.logWsEvent()` for confirmed events.
//   3. Workers call `AuditLogger.logWorkerJob()` for processed outbox events.
//
// The audit_logs table already exists (see packages/db/src/schema/audit.ts).
// This service adds the enrichment layer on top of the raw repository.
//
// ============================================================================

import type { PropagatedSession } from "../auth/sessionPropagation";

// ============================================================================
// Types
// ============================================================================

export type AuditSource = "http" | "ws" | "worker";

export type AuditAction =
  // Board
  | "board.created" | "board.updated" | "board.archived" | "board.deleted"
  | "board.member.added" | "board.member.removed" | "board.member.roleChanged"
  // List
  | "list.created" | "list.updated" | "list.deleted" | "list.moved"
  // Card
  | "card.created" | "card.updated" | "card.deleted" | "card.moved"
  // Auth
  | "auth.login" | "auth.logout" | "auth.tokenRefreshed" | "auth.tokenRevoked"
  | "auth.failed"
  // ACL
  | "acl.check.failed";

export interface AuditEntry {
  actorId:       string;
  tenantId:      string;
  action:        AuditAction;
  entityId:      string;
  entityType:    string;
  correlationId: string;
  // State snapshots — use {} for non-applicable (e.g. create has no beforeState)
  beforeState:   Record<string, unknown>;
  afterState:    Record<string, unknown>;
  // Observability
  traceId?:      string;
  spanId?:       string;
  // Client metadata
  ip?:           string;
  userAgent?:    string;
  source:        AuditSource;
  // Dual-revision tracking
  beforeRevision?: number;
  afterRevision?:  number;
  aclVersion?:     number;
}

export interface AuditRepository {
  insert(entry: Omit<AuditEntry, "source"> & {
    source: string;
  }): Promise<void>;
}

// ============================================================================
// AuditLogger
// ============================================================================

export class AuditLogger {
  constructor(
    private readonly repo: AuditRepository,
    private readonly logger: {
      info(payload: Record<string, unknown>): void;
      error(payload: Record<string, unknown>): void;
    },
  ) {}

  // ==========================================================================
  // 📝 log — primary entry-point for tRPC procedures
  // ==========================================================================

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.repo.insert(entry);

      this.logger.info({
        event:         "audit_log_written",
        action:        entry.action,
        entityId:      entry.entityId,
        entityType:    entry.entityType,
        actorId:       entry.actorId,
        tenantId:      entry.tenantId,
        correlationId: entry.correlationId,
        traceId:       entry.traceId,
        source:        entry.source,
      });
    } catch (err: any) {
      // Audit log write failure is non-fatal — log the error but don't throw
      this.logger.error({
        event:         "audit_log_write_failed",
        action:        entry.action,
        entityId:      entry.entityId,
        correlationId: entry.correlationId,
        error:         err?.message ?? "unknown",
      });
    }
  }

  // ==========================================================================
  // 🔧 fromSession — convenience builder
  // ==========================================================================

  /**
   * Create an audit entry pre-filled from a PropagatedSession and request
   * metadata.  The caller fills in action + entity + state fields.
   */
  fromSession(
    session:  PropagatedSession,
    metadata: { correlationId: string; traceId?: string; spanId?: string },
  ): Omit<AuditEntry, "action" | "entityId" | "entityType" | "beforeState" | "afterState"> {
    return {
      actorId:       session.userId,
      tenantId:      session.tenantId,
      correlationId: metadata.correlationId,
      traceId:       metadata.traceId,
      spanId:        metadata.spanId,
      ip:            session.ip,
      userAgent:     session.userAgent,
      source:        session.source,
      aclVersion:    session.aclVersion,
    };
  }

  // ==========================================================================
  // 📡 logWsEvent — confirmed WS domain event
  // ==========================================================================

  async logWsEvent(opts: {
    session:       PropagatedSession;
    boardId:       string;
    eventType:     string;
    correlationId: string;
    sequence:      string;
    payload:       Record<string, unknown>;
  }): Promise<void> {
    await this.log({
      actorId:       opts.session.userId,
      tenantId:      opts.session.tenantId,
      action:        opts.eventType as AuditAction,
      entityId:      opts.boardId,
      entityType:    "board",
      correlationId: opts.correlationId,
      beforeState:   {},
      afterState:    { sequence: opts.sequence, payload: opts.payload },
      source:        "ws",
      aclVersion:    opts.session.aclVersion,
    });
  }

  // ==========================================================================
  // 🏭 logWorkerJob — processed outbox/queue job
  // ==========================================================================

  async logWorkerJob(opts: {
    actorId:       string;
    tenantId:      string;
    action:        AuditAction;
    entityId:      string;
    entityType:    string;
    correlationId: string;
    traceId?:      string;
    beforeState:   Record<string, unknown>;
    afterState:    Record<string, unknown>;
    beforeRevision?: number;
    afterRevision?:  number;
  }): Promise<void> {
    await this.log({ ...opts, source: "worker" });
  }

  // ==========================================================================
  // 🔐 logAuthEvent — auth lifecycle events
  // ==========================================================================

  async logAuthEvent(opts: {
    actorId:       string;
    tenantId:      string;
    action:        Extract<AuditAction,
      "auth.login" | "auth.logout" | "auth.tokenRefreshed" |
      "auth.tokenRevoked" | "auth.failed">;
    correlationId: string;
    ip?:           string;
    userAgent?:    string;
    details?:      Record<string, unknown>;
  }): Promise<void> {
    await this.log({
      actorId:       opts.actorId,
      tenantId:      opts.tenantId,
      action:        opts.action,
      entityId:      opts.actorId,   // actor is the entity for auth events
      entityType:    "user",
      correlationId: opts.correlationId,
      beforeState:   {},
      afterState:    opts.details ?? {},
      ip:            opts.ip,
      userAgent:     opts.userAgent,
      source:        "http",
    });
  }

  // ==========================================================================
  // ⚠️ logAclFailure — denied access attempts
  // ==========================================================================

  async logAclFailure(opts: {
    session:       PropagatedSession;
    action:        string;
    entityId:      string;
    entityType:    string;
    correlationId: string;
    reason:        string;
  }): Promise<void> {
    await this.log({
      actorId:       opts.session.userId,
      tenantId:      opts.session.tenantId,
      action:        "acl.check.failed",
      entityId:      opts.entityId,
      entityType:    opts.entityType,
      correlationId: opts.correlationId,
      beforeState:   {},
      afterState:    { deniedAction: opts.action, reason: opts.reason },
      ip:            opts.session.ip,
      userAgent:     opts.session.userAgent,
      source:        opts.session.source,
    });
  }
}
