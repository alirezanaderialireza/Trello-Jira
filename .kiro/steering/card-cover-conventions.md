---
inclusion: always
---

# Card Cover — Phase 1.2 (F1.2.7) Conventions

---

## Decision Points (D1..D14)

| # | Decision | Resolution |
|---|---|---|
| D1 | Storage | `cover_data JSONB` — dedicated column on `cards`. `accounting_data` is reserved for accounting module. |
| D2 | Image cover | Parked → F1.2.8 (Attachments). V1 = color + gradient only. |
| D3 | CardItem preview | 40px absolute cover strip at top of card. `overflow-hidden` + `pt-12` when cover present. |
| D4 | CoverPicker UI | Inline card-detail section (not popup). Color grid (6 cols) + gradient grid (4 cols). |
| D5 | Router pattern | Exact mirror of `due-date.router.ts` — boardProtectedProcedure + withIdempotency + topology guard + outbox. |
| D6 | Event | `card.cover_updated` schemaVersion 2. null = cleared. |
| D7 | CardDto | Optional `coverData?: { type: string; id: string } \| null`. |
| D8 | Store | No new slice — coverData on CardDto. `applyCardCoverUpdated` reducer. |
| D9 | board.read-models | `coverData: card.coverData ?? null` in card projection map. |
| D10 | Optimistic | Direct `store.updateCard({ coverData })` + rollback on error. |
| D11 | Keyboard | None in V1. |
| D12 | Migration | `0012_phase1.2_card_cover.sql` — ADD COLUMN IF NOT EXISTS. |
| D13 | Event type | `"card.cover_updated"` — added to `DomainEventType` union in `base.ts`. |
| D14 | CoverData type | `{ type: "color" \| "gradient", id: string }` — same as `BackgroundData` from `backgroundPresets.ts`. |

---

## Schema

```sql
ALTER TABLE cards ADD COLUMN IF NOT EXISTS cover_data jsonb;
CREATE INDEX IF NOT EXISTS idx_cards_cover ON cards (tenant_id)
  WHERE cover_data IS NOT NULL AND deleted_at IS NULL;
```

No new RLS policy — `cover_data` inherits existing cards RLS.

---

## CoverData Shape

```ts
{ type: "color" | "gradient", id: string }
```

Same as `BackgroundData` from `apps/web/src/features/board-settings/lib/backgroundPresets.ts`.

Token palette:
- Colors: 12 HSL presets (blue, indigo, purple, pink, red, orange, yellow, green, teal, forest, gray, charcoal)
- Gradients: 8 linear gradients (sunset, ocean, forest-grad, aurora, fire, pastel, night, spring)

Use `renderBackgroundCss(coverData)` from `applyBackground.ts` to get CSS string.
Use `isBackgroundData(x)` to validate before rendering.

---

## Domain Event (`card.cover_updated`)

```ts
CardCoverUpdatedPayload: {
  cardId, boardId,
  oldCover: CoverData | null,
  newCover: CoverData | null,  // null = cleared
  updatedBy: string
}
```

schemaVersion: 2. Mirrored `CardDueDateUpdatedEvent` pattern.

---

## API (`v1.public.cover.setCover`)

```
setCover({ cardId, boardId, coverData: { type, id } | null, idempotencyKey })
  → { success, noOp, coverData }
```

boardProtectedProcedure + withIdempotency + topology guard.
IDEMPOTENCY_SCHEMA_VERSION = "card.cover.v2".

---

## CardItem Cover Region

Absolute-positioned div inside the card's relative container:
```
className="absolute inset-x-0 top-0 h-10 rounded-t-lg"
style={{ background: renderBackgroundCss(coverData) }}
```
Card outer div gets `overflow-hidden` and `pt-12` when cover is present.

---

## Don't

- **Don't** put `cover_data` inside `accounting_data` — dedicated column (D1).
- **Don't** render inline CSS for cover — always `renderBackgroundCss()`.
- **Don't** render without `isBackgroundData()` guard — null-safe.
- **Don't** implement image cover — parked to F1.2.8.
- **Don't** import `backgroundPresets.ts` from `packages/` — client-only.

---

## Parked

- Image cover → F1.2.8 (Attachments).
- Cover size variants (full/top/cropped) → polish.
- Cover auto-contrast text → polish.
- Activity timeline for cover → Activity router `card.cover_updated` case.
