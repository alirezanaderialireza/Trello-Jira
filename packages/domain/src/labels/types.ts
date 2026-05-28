// packages/domain/src/labels/types.ts
//
// Phase 1.2 (F1.2.1) label types — branded IDs, the canonical 12-token
// colour palette, the LabelEntity domain model, and the LabelRepository
// port.
//
// Wire-level strings (event payloads, tRPC inputs) stay as plain `string`;
// branding happens at the entity/repository boundary so application code
// can't accidentally pass a UserId where a LabelId is expected. This
// matches the convention already in `shared/ids.ts`.

import type { BoardId, CardId, TenantId, UserId } from "../shared/ids";
import type { Position } from "../ordering/position";
import type { FindOptions } from "../ports";

// ============================================================================
// 1. Branded LabelId
// ============================================================================

export type LabelId = string & { readonly __brand: "LabelId" };

// ============================================================================
// 2. Colour Token Palette
// ============================================================================
// Twelve named tokens — eleven hue stops at the `.500` brightness plus a
// neutral `black`. The DB CHECK (`labels_color_token_check` in migration
// 0007) and the Drizzle `check()` mirror these values. Adding or removing
// a token therefore requires a coordinated migration + schema update.

export type ColorToken =
  | "red.500"
  | "orange.500"
  | "yellow.500"
  | "green.500"
  | "teal.500"
  | "blue.500"
  | "indigo.500"
  | "purple.500"
  | "pink.500"
  | "gray.500"
  | "brown.500"
  | "black";

/**
 * Canonical ordering. Used by:
 *   • Zod schemas (z.enum(...COLOR_TOKENS) gives compile-time exhaustiveness)
 *   • UI swatch grid order (RTL rendering still respects this sequence)
 *   • Use-case validators
 */
export const COLOR_TOKENS = [
  "red.500",
  "orange.500",
  "yellow.500",
  "green.500",
  "teal.500",
  "blue.500",
  "indigo.500",
  "purple.500",
  "pink.500",
  "gray.500",
  "brown.500",
  "black",
] as const satisfies readonly ColorToken[];

/**
 * Persian display names for each colour token. Surfaced in the picker
 * tooltip and the colour-swatch screen-reader label so the picker is
 * navigable by keyboard + screen reader without relying on hex codes.
 */
export const COLOR_TOKEN_LABELS_FA: Record<ColorToken, string> = {
  "red.500":    "قرمز",
  "orange.500": "نارنجی",
  "yellow.500": "زرد",
  "green.500":  "سبز",
  "teal.500":   "فیروزه‌ای",
  "blue.500":   "آبی",
  "indigo.500": "نیلی",
  "purple.500": "بنفش",
  "pink.500":   "صورتی",
  "gray.500":   "خاکستری",
  "brown.500":  "قهوه‌ای",
  "black":      "سیاه",
};

/** Type guard — useful at the API boundary where input is `string`. */
export function isColorToken(value: string): value is ColorToken {
  return (COLOR_TOKENS as readonly string[]).includes(value);
}

// ============================================================================
// 3. Label Entity — the domain model
// ============================================================================

export interface LabelEntity {
  readonly id:         LabelId;
  readonly tenantId:   TenantId;
  readonly boardId:    BoardId;
  readonly name:       string;
  readonly colorToken: ColorToken;
  readonly position:   Position;
  readonly createdAt:  Date;
  readonly createdBy:  UserId;
  readonly updatedAt:  Date;
  readonly deletedAt:  Date | null;
}

/** Junction-row projection — appears in card detail / activity reads. */
export interface CardLabelLink {
  readonly cardId:    CardId;
  readonly labelId:   LabelId;
  readonly tenantId:  TenantId;
  readonly appliedBy: UserId;
  readonly appliedAt: Date;
}

/** Patch shape accepted by `LabelRepository.update`. */
export type LabelPatch = Partial<
  Pick<LabelEntity, "name" | "colorToken" | "position">
>;

// ============================================================================
// 4. Repository Port
// ============================================================================
// The infrastructure layer (DrizzleLabelsRepository in @repo/db) implements
// this port. Routers depend on the interface, never on the concrete class —
// this keeps tests fast (in-memory fake) and keeps the `db` element from
// leaking into the `domain` element under the boundaries linter.

export interface LabelRepository<TTx = unknown> {
  // ── Reads ────────────────────────────────────────────────────────────────

  findById(
    id: LabelId,
    options?: FindOptions<TTx>,
  ): Promise<LabelEntity | null>;

  findByBoardId(
    boardId: BoardId,
    options?: FindOptions<TTx>,
  ): Promise<LabelEntity[]>;

  findCardLabelsByCardId(
    cardId: CardId,
    options?: FindOptions<TTx>,
  ): Promise<LabelEntity[]>;

  /** Lookup a single junction row (used by `applyLabelToCard` idempotency). */
  findCardLabelLink(
    params: { cardId: CardId; labelId: LabelId },
    options?: FindOptions<TTx>,
  ): Promise<CardLabelLink | null>;

  countCardsWithLabel(
    labelId: LabelId,
    options?: FindOptions<TTx>,
  ): Promise<number>;

  // ── Writes — always require an explicit tx for atomicity with outbox ────

  create(tx: TTx, entity: LabelEntity): Promise<void>;

  update(tx: TTx, id: LabelId, patch: LabelPatch): Promise<void>;

  /** Sets `deleted_at = now()`. Junction rows are removed separately. */
  softDelete(tx: TTx, id: LabelId): Promise<void>;

  /** Hard-deletes every junction row pointing at the given label. */
  hardDeleteJunctionByLabelId(tx: TTx, labelId: LabelId): Promise<void>;

  /** Inserts a junction row. Returns false if the row already exists. */
  applyLabelToCard(
    tx: TTx,
    link: CardLabelLink,
  ): Promise<{ inserted: boolean }>;

  /** Removes a junction row. Returns false if the row didn't exist. */
  removeLabelFromCard(
    tx: TTx,
    params: { cardId: CardId; labelId: LabelId },
  ): Promise<{ removed: boolean }>;
}
