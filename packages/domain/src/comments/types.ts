// packages/domain/src/comments/types.ts
//
// Phase 1.2 (F1.2.4.a) — branded IDs, entity shape, repository port,
// and patch types for comments.
//
// Mirrors the checklists/types.ts pattern from F1.2.3.a.
// Wire-level strings (event payloads, tRPC inputs) stay as plain
// `string`; branding happens at the entity/repository boundary.

import type { BoardId, CardId, TenantId, UserId } from "../shared/ids";
import type { FindOptions } from "../ports";

// ============================================================================
// 1. Branded ID
// ============================================================================

export type CommentId = string & { readonly __brand: "CommentId" };

// ============================================================================
// 2. Entity
// ============================================================================

export interface CommentEntity {
  readonly id:        CommentId;
  readonly tenantId:  TenantId;
  readonly cardId:    CardId;
  readonly boardId:   BoardId;
  readonly authorId:  UserId;
  readonly body:      string;
  /** Incremented on every mutation for OCC + event versioning. */
  readonly revision:  number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Set when the author (or admin) edits the body. */
  readonly editedAt:  Date | null;
  /** Set when the comment is soft-deleted. */
  readonly deletedAt: Date | null;
  /** UserId of whoever triggered the soft-delete. */
  readonly deletedBy: UserId | null;
}

// ============================================================================
// 3. Patch types
// ============================================================================

/** Fields the repository's update() method accepts. */
export type CommentPatch = Partial<
  Pick<CommentEntity, "body" | "editedAt" | "updatedAt" | "revision">
>;

/** Fields the repository's softDelete() method accepts. */
export type CommentDeletePatch = Pick<
  CommentEntity,
  "deletedAt" | "deletedBy" | "updatedAt" | "revision"
>;

// ============================================================================
// 4. Author projection (for F1.2.4.b UI — read-side only)
// ============================================================================
// Returned by findByIdWithAuthor — joins to the users table so the
// UI can render the display name and avatar without a second round-trip.

export interface CommentWithAuthor extends CommentEntity {
  readonly authorDisplayName: string;
  readonly authorAvatarUrl:   string | null;
}

// ============================================================================
// 5. Repository port
// ============================================================================
// The infrastructure layer (DrizzleCommentsRepository in @repo/db)
// implements this port. Routers depend on the interface, never on the
// concrete class — keeps tests fast and prevents db from leaking into domain.

export interface CommentsRepository<TTx = unknown> {
  // ── Reads ────────────────────────────────────────────────────────────────

  findById(
    id:       CommentId,
    options?: FindOptions<TTx>,
  ): Promise<CommentEntity | null>;

  /** Join with users table — used by F1.2.4.b list query. */
  findByIdWithAuthor(
    id:       CommentId,
    options?: FindOptions<TTx>,
  ): Promise<CommentWithAuthor | null>;

  /**
   * Cursor-based pagination, newest-first (desc createdAt).
   * Returns up to `limit + 1` rows so the caller can detect hasMore.
   */
  findByCardId(
    cardId:  CardId,
    options: FindOptions<TTx> & {
      limit:   number;
      cursor?: CommentId;
    },
  ): Promise<CommentEntity[]>;

  /**
   * Same as findByCardId but JOINs with users for display names.
   * Used by the list procedure in F1.2.4.b.
   */
  findByCardIdWithAuthors(
    cardId:  CardId,
    options: FindOptions<TTx> & {
      limit:   number;
      cursor?: CommentId;
    },
  ): Promise<CommentWithAuthor[]>;

  // ── Writes — always require an explicit tx for atomicity with outbox ────

  create(tx: TTx, entity: CommentEntity): Promise<void>;

  update(
    tx:    TTx,
    id:    CommentId,
    patch: CommentPatch,
  ): Promise<void>;

  /** Sets deletedAt + deletedBy + revision++. Body is preserved. */
  softDelete(
    tx:    TTx,
    id:    CommentId,
    patch: CommentDeletePatch,
  ): Promise<void>;
}
