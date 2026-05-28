// packages/domain/src/checklists/types.ts
//
// Phase 1.2 (F1.2.3.a) checklist types — branded IDs, the entity
// shapes (Checklist + ChecklistItem), and the ChecklistsRepository
// port.
//
// Wire-level strings (event payloads, tRPC inputs) stay as plain
// `string`; branding happens at the entity/repository boundary so
// application code can't accidentally pass a UserId where a
// ChecklistId is expected. Mirrors the labels-types pattern from
// F1.2.1.

import type {
  BoardId,
  CardId,
  TenantId,
  UserId,
} from "../shared/ids";
import type { Position } from "../ordering/position";
import type { FindOptions } from "../ports";

// ============================================================================
// 1. Branded IDs
// ============================================================================

export type ChecklistId     = string & { readonly __brand: "ChecklistId" };
export type ChecklistItemId = string & { readonly __brand: "ChecklistItemId" };

// ============================================================================
// 2. Entities
// ============================================================================

export interface ChecklistEntity {
  readonly id:        ChecklistId;
  readonly tenantId:  TenantId;
  readonly cardId:    CardId;
  readonly boardId:   BoardId;
  readonly title:     string;
  readonly position:  Position;
  readonly createdAt: Date;
  readonly createdBy: UserId;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export interface ChecklistItemEntity {
  readonly id:          ChecklistItemId;
  readonly tenantId:    TenantId;
  readonly checklistId: ChecklistId;
  readonly text:        string;
  readonly isDone:      boolean;
  readonly position:    Position;
  readonly createdAt:   Date;
  readonly createdBy:   UserId;
  readonly updatedAt:   Date;
}

/** Patch shape accepted by `ChecklistsRepository.updateChecklist`. */
export type ChecklistPatch = Partial<
  Pick<ChecklistEntity, "title" | "position">
>;

/** Patch shape accepted by `ChecklistsRepository.updateChecklistItem`. */
export type ChecklistItemPatch = Partial<
  Pick<ChecklistItemEntity, "text" | "isDone" | "position">
>;

// ============================================================================
// 3. Repository Port
// ============================================================================
// The infrastructure layer (DrizzleChecklistsRepository in @repo/db)
// implements this port. Routers depend on the interface, never on the
// concrete class — keeps tests fast (in-memory fake) and keeps the
// `db` element from leaking into the `domain` element under the
// boundaries linter.

export interface ChecklistsRepository<TTx = unknown> {
  // ── Reads ────────────────────────────────────────────────────────────────

  findChecklistById(
    id: ChecklistId,
    options?: FindOptions<TTx>,
  ): Promise<ChecklistEntity | null>;

  findChecklistsByCardId(
    cardId: CardId,
    options?: FindOptions<TTx>,
  ): Promise<ChecklistEntity[]>;

  findItemById(
    id: ChecklistItemId,
    options?: FindOptions<TTx>,
  ): Promise<ChecklistItemEntity | null>;

  findItemsByChecklistId(
    checklistId: ChecklistId,
    options?: FindOptions<TTx>,
  ): Promise<ChecklistItemEntity[]>;

  /** Counts the items belonging to a checklist; used by delete-confirm UX. */
  countItemsByChecklistId(
    checklistId: ChecklistId,
    options?: FindOptions<TTx>,
  ): Promise<number>;

  // ── Writes — always require an explicit tx for atomicity with outbox ────

  createChecklist(tx: TTx, entity: ChecklistEntity): Promise<void>;

  updateChecklist(
    tx: TTx,
    id: ChecklistId,
    patch: ChecklistPatch,
  ): Promise<void>;

  /** Sets `deleted_at = now()`. Items are hard-deleted separately. */
  softDeleteChecklist(tx: TTx, id: ChecklistId): Promise<void>;

  /** Hard-deletes every item belonging to the checklist. */
  hardDeleteItemsByChecklistId(
    tx: TTx,
    checklistId: ChecklistId,
  ): Promise<void>;

  createItem(tx: TTx, entity: ChecklistItemEntity): Promise<void>;

  updateItem(
    tx: TTx,
    id: ChecklistItemId,
    patch: ChecklistItemPatch,
  ): Promise<void>;

  removeItem(tx: TTx, id: ChecklistItemId): Promise<void>;
}
