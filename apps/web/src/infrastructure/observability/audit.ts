// apps/web/src/infrastructure/observability/audit.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Immutable, append-only audit trail for all security-sensitive and
// domain-critical events. Integrates with Phase 2 ACL, Phase 3 Collab,
// and Phase 6 Replay Engine for full traceability.
// ─────────────────────────────────────────────────────────────────────────────

import { computeChecksumSync, type Checksum } from "@/lib/integrity/canonicalSerializer";
import { logger } from "./logging";

// ============================================================================
// 1.  Types
// ============================================================================

export type AuditCategory =
  | "domain_event"
  | "auth"
  | "acl_check"
  | "acl_violation"
  | "mutation_lifecycle"
  | "replay"
  | "session"
  | "system";

export interface AuditEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly category: AuditCategory;
  readonly actorId: string;
  readonly tenantId: string;
  readonly boardId?: string;
  readonly correlationId?: string;
  readonly traceId?: string;
  readonly action: string;
  readonly outcome: "success" | "denied" | "error";
  readonly details: Record<string, unknown>;
  /** SHA-256/djb2 checksum over (action + actorId + timestamp + payload). */
  readonly integrity: Checksum;
}

export interface AuditConfig {
  enabled: boolean;
  maxBufferSize: number;
  exportEndpoint?: string;
  exportFn?: (entries: AuditEntry[]) => Promise<void>;
}

const DEFAULT_CONFIG: AuditConfig = {
  enabled: true,
  maxBufferSize: 200,
};

// ============================================================================
// 2.  AuditTrail
// ============================================================================

export class AuditTrail {
  private config: AuditConfig;
  private buffer: AuditEntry[] = [];

  constructor(config: Partial<AuditConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  configure(overrides: Partial<AuditConfig>): void {
    this.config = { ...this.config, ...overrides };
  }

  /**
   * Record an audit entry. The integrity checksum is computed automatically.
   */
  record(entry: Omit<AuditEntry, "id" | "timestamp" | "integrity">): void {
    if (!this.config.enabled) return;

    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    // Compute integrity checksum over the auditable fields.
    const integrityInput = {
      action: entry.action,
      actorId: entry.actorId,
      tenantId: entry.tenantId,
      timestamp,
      details: entry.details,
    };
    const integrity = computeChecksumSync(integrityInput);

    const full: AuditEntry = { ...entry, id, timestamp, integrity };

    this.buffer.push(full);

    // Log for immediate observability.
    logger.info(
      `audit.${entry.category}`,
      entry.correlationId ?? id,
      entry.outcome === "success" ? "success" : "fail",
      { action: entry.action, category: entry.category },
    );

    if (this.buffer.length >= this.config.maxBufferSize) {
      this.flush();
    }
  }

  // ── Convenience methods ────────────────────────────────────────────────────

  recordDomainEvent(
    actorId: string,
    tenantId: string,
    action: string,
    details: Record<string, unknown>,
    opts?: { boardId?: string; correlationId?: string; traceId?: string },
  ): void {
    this.record({
      category: "domain_event",
      actorId,
      tenantId,
      action,
      outcome: "success",
      details,
      ...opts,
    });
  }

  recordAclViolation(
    actorId: string,
    tenantId: string,
    action: string,
    details: Record<string, unknown>,
    opts?: { boardId?: string; correlationId?: string },
  ): void {
    this.record({
      category: "acl_violation",
      actorId,
      tenantId,
      action,
      outcome: "denied",
      details,
      ...opts,
    });
  }

  recordAuth(
    actorId: string,
    tenantId: string,
    action: string,
    outcome: AuditEntry["outcome"],
    details: Record<string, unknown>,
  ): void {
    this.record({ category: "auth", actorId, tenantId, action, outcome, details });
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const entries = this.buffer.splice(0);

    if (this.config.exportFn) {
      await this.config.exportFn(entries);
      return;
    }

    if (this.config.exportEndpoint) {
      try {
        await fetch(this.config.exportEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audit: entries }),
          keepalive: true,
        });
      } catch { /* best-effort */ }
    }
  }

  getBuffer(): readonly AuditEntry[] {
    return this.buffer;
  }

  clearBuffer(): void {
    this.buffer.length = 0;
  }

  /**
   * Verify integrity of a previously-recorded audit entry.
   * Recomputes the checksum and compares.
   */
  verifyEntry(entry: AuditEntry): boolean {
    const integrityInput = {
      action: entry.action,
      actorId: entry.actorId,
      tenantId: entry.tenantId,
      timestamp: entry.timestamp,
      details: entry.details,
    };
    const computed = computeChecksumSync(integrityInput);
    return computed.hash === entry.integrity.hash;
  }
}

// ============================================================================
// 3.  Singleton
// ============================================================================

export const audit = new AuditTrail();
