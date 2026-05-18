// packages/domain/src/card/create-card.ts
//
// Fixes applied:
// ✅ #D-12: CreateCardInput.id typed as BoardId — should be CardId.
//           A function creating a Card entity should accept a CardId for the
//           card's own id, not a BoardId. This was a copy-paste error from
//           board types. At runtime both are plain strings so no crash, but the
//           type contract is wrong and allows passing a BoardId where CardId is
//           expected without a compile-time error.

import type { CardId, BoardId, TenantId, Revision } from "../shared/ids";
import type { Card } from "./types";

const MAX_CARD_TITLE_LENGTH = 255;

const INITIAL_REVISION = 1 as Revision;

export interface CreateCardInput {
  // ✅ #D-12: id is the card's own identity — must be CardId, not BoardId
  readonly id:          CardId;
  readonly tenantId:    TenantId;
  readonly boardId:     BoardId;
  readonly listId:      string;
  readonly title:       string;
  readonly description?: string | null;
  readonly position:    string;
  readonly createdAt:   Date;
}

// ============================================================================
// Pure Card Factory
// ----------------------------------------------------------------------------
// - deterministic
// - side-effect free
// - tenant-safe
// - OCC-ready
// - runtime validated
// - invariant protected
// ============================================================================

export function createCard(input: CreateCardInput): Card {
  const title = normalizeTitle(input.title);
  const position = normalizePosition(input.position);
  const createdAt = normalizeDate(input.createdAt);
  const description = normalizeDescription(input.description);

  return {
    id: input.id,
    tenantId: input.tenantId,
    boardId: input.boardId,
    listId: input.listId,
    title,
    description,
    position,
    revision: INITIAL_REVISION,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

// ============================================================================
// Normalizers — throw native errors (pure functions, no DomainError dependency)
// ============================================================================

function normalizeTitle(raw: string): string {
  if (typeof raw !== "string") {
    throw new TypeError("Card title must be a string");
  }
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    throw new RangeError("Card title cannot be empty");
  }
  if (normalized.length > MAX_CARD_TITLE_LENGTH) {
    throw new RangeError(`Card title exceeds maximum length of ${MAX_CARD_TITLE_LENGTH}`);
  }
  return normalized;
}

function normalizePosition(raw: string): string {
  if (typeof raw !== "string") {
    throw new TypeError("Card position must be a string");
  }
  const normalized = raw.trim();
  if (normalized.length === 0) {
    throw new RangeError("Card position is required");
  }
  return normalized;
}

function normalizeDescription(raw?: string | null): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new TypeError("Card description must be a string");
  }
  const normalized = raw.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizeDate(raw: Date): Date {
  if (!(raw instanceof Date)) {
    throw new TypeError("Creation timestamp must be a Date instance");
  }
  if (Number.isNaN(raw.getTime())) {
    throw new RangeError("Invalid creation timestamp");
  }
  return raw;
}