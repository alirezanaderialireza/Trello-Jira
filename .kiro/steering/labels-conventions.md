---
inclusion: always
---

# Labels — Phase 1.2 (F1.2.1) Conventions

Persistence and behavioural rules for the labels feature. Mirrors the
F1.2.1.a contract; F1.2.1.b builds the UI on top.

## Schema (migration `0007_phase1.2_labels.sql`)

`labels`
- Tenant-scoped, board-scoped. RLS enforces tenant isolation **plus**
  board membership (the SELECT/INSERT/UPDATE/DELETE policies all
  contain an `EXISTS (SELECT 1 FROM board_members …)` predicate).
- `color_token varchar(20)` — enum-like, locked by a CHECK constraint
  to the canonical 12-token palette. Mirror the list in
  `packages/domain/src/labels/types.ts → COLOR_TOKENS` and the Drizzle
  `check()` in `packages/db/src/schema/labels.ts`.
- `position varchar(255)` — LexoRank string. Generated server-side on
  create (`label.create` calls `getNewPosition(lastPosition, undefined)`
  in the router). Updated client-side on drag-and-drop reorder via
  `label.update({ position })`.
- `name varchar(50)` — Persian-friendly. Case-insensitive uniqueness
  per board enforced by `idx_labels_unique_name_per_board`
  (`UNIQUE … WHERE deleted_at IS NULL`). Folding uses
  `String.prototype.toLocaleLowerCase("fa-IR")` in the use case so
  the JS code path matches the SQL `LOWER()` semantics.
- `deleted_at timestamptz` — soft delete. The 30-day janitor (Phase 1.5)
  hard-purges tombstoned rows.

`card_labels` (junction)
- Composite PK `(card_id, label_id)`. **No synthetic `id`.**
- `tenant_id` is denormalised so the RLS predicate is a pure index
  lookup. Defended by the router always inserting `tenantId` from
  `ctx.session` (never from input) and by the migration's INSERT WITH
  CHECK `tenant_id = current_tenant_id()`.
- RLS is tenant-only (no membership EXISTS) — the `labels` policy
  already enforces membership and the junction is reachable only
  through it. Adding the membership predicate here would force a
  four-table planner shape with no security benefit.

## Domain (`packages/domain/src/labels`)

- `LabelId` is branded; events carry plain `string`s (rebranding
  happens at the repository boundary).
- `ColorToken` is a literal union; `isColorToken(value)` is the type
  guard for the API boundary.
- Use cases are **pure** — they accept resolved DB facts (existing
  names, alreadyApplied flag, affectedCardCount) and return either
  `{ entity, event }` or `{ noOp: true }`. Side effects live in the
  router.
- Errors carry an English `code` plus a stable class name; the router
  maps them through `toTRPCError` (one place to retune the
  English-code/Persian-message pairing).

## Events (schema version 2)

| Type                  | Aggregate    | Payload v2 fields                                |
|-----------------------|--------------|--------------------------------------------------|
| `label.created`       | board        | labelId, boardId, name, **colorToken**, **position**, **createdBy** |
| `label.updated`       | board        | labelId, boardId, changes (name?, **colorToken**?, **position**?)   |
| `label.deleted`       | board        | labelId, boardId, **affectedCardCount**          |
| `card.label_added`    | card         | cardId, boardId, labelId, **appliedBy**          |
| `card.label_removed`  | card         | cardId, boardId, labelId                         |

**Snake-case retained on purpose.** Spec drafts called for
`card.label.applied` / `card.label.removed`, but the project-wide
convention for sub-resource events is snake_case verbs
(`card.assignee_added`, `card.due_date_updated`, …) and the existing
dispatcher / reducers were already keying off `card.label_added` /
`card.label_removed`. D13 standardised on the existing convention.

## Authorisation (D8)

| Action                      | Procedure                          | Extra check                |
|-----------------------------|------------------------------------|----------------------------|
| list / listByCard           | `boardProtectedProcedure`          | —                          |
| create                      | `boardProtectedProcedure`          | —                          |
| applyToCard / removeFromCard| `boardProtectedProcedure`          | —                          |
| update                      | `boardProtectedProcedure`          | inline: creator OR admin   |
| delete                      | `boardAdminProcedure` (D12)        | enforced by procedure      |

`boardAdminProcedure` is the **only** F2-style builder added so far
(D12 minimal scope). Workspace-level admin checks still use the inline
pattern in `workspaces/members.router.ts` until a featurelet actually
demands a builder.

## Outbox + Idempotency

Every mutation uses the same skeleton:

```
mutation: boardXProcedure.input(…).mutation(({ input, ctx }) =>
  withIdempotency(ctx, input.idempotencyKey, async () => {
    const repo = new DrizzleLabelsRepository(ctx.tx);
    // 1. read use-case prerequisites from repo (tx-scoped)
    // 2. run the pure use case
    // 3. await repo.<write>(ctx.tx, …)
    // 4. await ctx.repos.outbox.append(ctx.tx, toOutboxEvent(event))
    // 5. return response (cached by withIdempotency)
  })
)
```

- `idempotencyKey` is required on every mutation input (`uuid` schema).
- The atomic-outbox guarantee depends on **both** the repository write
  and `ctx.repos.outbox.append` running on the same `ctx.tx`. The
  `tenantContextMiddleware` already opens that tx; nothing else needs
  to compose.
- For idempotent applies / removes (`applyToCard`, `removeFromCard`),
  the outbox emit is gated on `inserted === true` / `removed === true`
  so a concurrent winner doesn't double-emit.

## Persian text

- `name` accepts emoji-prefixed Persian. Validation trims whitespace
  before length + duplicate checks (use case enforces).
- Case-insensitive duplicate detection uses
  `toLocaleLowerCase("fa-IR")` to match the DB's `LOWER()` semantics.
- Error messages are Persian; codes (BAD_REQUEST, CONFLICT, NOT_FOUND,
  FORBIDDEN) are English so the client can branch on them.
- The 12 colour tokens have Persian display names in
  `COLOR_TOKEN_LABELS_FA` — the picker tooltip and the swatch
  `aria-label` source from there, never from the token string.

## Don't

- **Don't** read `payload.color` on a label event. v2 renamed it
  to `colorToken`.
- **Don't** add a label to a card without going through the router —
  inserting a `card_labels` row directly skips the use-case's
  cross-board guard (`LabelBoardMismatchError`) and the outbox emit.
- **Don't** hard-delete a label. Soft-delete (`deleted_at = now()`)
  preserves the activity timeline; junction rows are hard-deleted in
  the same tx.
- **Don't** trust client-supplied `tenantId` or `appliedBy` —
  the router always populates these from `ctx.session`.
- **Don't** rely on the `boardId` field of a label being writable —
  labels can't move between boards (would require a `board_id` UPDATE
  policy, which we deliberately don't have). A future
  "duplicate label to another board" feature ships as a separate
  procedure with its own outbox event.

## F1.2.1.b checklist (UI follow-up)

- LabelBadge — colored pill rendering `colorToken` via the canonical
  CSS-token map.
- LabelPicker — popover with case-insensitive (`fa-IR` lower) search +
  keyboard nav; opens on `L` key in card modal.
- LabelManager — Board Settings tab "برچسب‌ها"; `@dnd-kit/sortable`
  for reorder, calls `label.update({ position })`.
- CreateLabelForm — 12-swatch grid (RTL: first colour on the right).
- DeleteLabelDialog — surfaces the response's `affectedCardCount`.
- CardItem update — top 3 labels by position + "+N" badge for the
  rest. Wrapped in `React.memo` (R3 mitigation).
- Replace the `card-detail/CardLabels.tsx` stub with the new picker
  surface.
