// packages/db/src/repositories/audit.repository.ts

import type { DbTx } from "./board.repository";
import type { AuditRepository, AuditLog } from "@repo/domain";
import { auditLogs } from "../schema";

// ============================================================================
// DrizzleAuditRepository (Enterprise-Grade)
// ============================================================================

export class DrizzleAuditRepository implements AuditRepository<DbTx> {
  constructor(private readonly db: DbTx) {}

  // ========================================================================
  // Append an Audit Log Entry
  // ========================================================================
  async append(tx: DbTx, log: AuditLog): Promise<void> {
    await tx.insert(auditLogs).values({
      actorId: log.actorId,
      tenantId: log.tenantId,
      action: log.action,
      entityId: log.entityId,
      entityType: log.entityType,
      correlationId: log.correlationId,
      beforeState: log.beforeState,
      afterState: log.afterState,
      createdAt: log.createdAt ?? new Date(),
    });
  }
}