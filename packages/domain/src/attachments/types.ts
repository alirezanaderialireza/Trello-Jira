// packages/domain/src/attachments/types.ts
//
// Phase 1.2 (F1.2.8) — Attachments domain types.
// Two sub-types: "file" (uploaded to R2/MinIO) and "link" (external URL).

import type { BoardId, CardId, TenantId, UserId } from "../shared/ids";
import type { FindOptions } from "../ports";

// ============================================================================
// 1. Branded ID
// ============================================================================

export type AttachmentId = string & { readonly __brand: "AttachmentId" };

export type AttachmentType = "file" | "link";

// ============================================================================
// 2. Entity
// ============================================================================

export interface AttachmentEntity {
  readonly id:         AttachmentId;
  readonly tenantId:   TenantId;
  readonly cardId:     CardId;
  readonly boardId:    BoardId;
  readonly type:       AttachmentType;
  readonly url:        string;
  /** objectKey in R2/MinIO. null for link attachments. */
  readonly objectKey:  string | null;
  readonly mimeType:   string | null;
  readonly fileName:   string;
  readonly sizeBytes:  number | null;
  /** Optional display title for link attachments. */
  readonly title:      string | null;
  /** varchar(128) — userId of the uploader. */
  readonly uploadedBy: string;
  readonly createdAt:  Date;
  readonly deletedAt:  Date | null;
}

// ============================================================================
// 3. Helpers
// ============================================================================

/** True when the attachment is an image (can be used as card cover). */
export function isImageAttachment(entity: AttachmentEntity): boolean {
  return (entity.mimeType ?? "").startsWith("image/");
}

// ============================================================================
// 4. Repository port
// ============================================================================

export interface AttachmentsRepository<TTx = unknown> {
  // ── Reads ────────────────────────────────────────────────────────────────

  findById(
    id:       AttachmentId,
    options?: FindOptions<TTx>,
  ): Promise<AttachmentEntity | null>;

  findByCardId(
    cardId:  CardId,
    options?: FindOptions<TTx>,
  ): Promise<AttachmentEntity[]>;

  countByCardId(
    cardId:  CardId,
    options?: FindOptions<TTx>,
  ): Promise<number>;

  // ── Writes ───────────────────────────────────────────────────────────────

  create(tx: TTx, entity: AttachmentEntity): Promise<void>;

  /** Sets deleted_at = now(). objectKey is preserved for storage cleanup. */
  softDelete(tx: TTx, id: AttachmentId): Promise<void>;
}
