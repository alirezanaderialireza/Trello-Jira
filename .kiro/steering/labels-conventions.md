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

## F1.2.1.b checklist (UI — shipped)

All items shipped in F1.2.1.b. Footnote tracks any deviation from the
original phrasing.

- ✓ **LabelBadge** — colored pill rendering `colorToken` via the
  canonical CSS-token map.
- ✓ **LabelPicker** — popover with case-insensitive (`fa-IR` lower)
  search + keyboard nav; opens on `L` key in card modal.
- ✓ **LabelManager** — Board Settings tab "برچسب‌ها";
  `@dnd-kit/sortable` for reorder, calls `label.update({ position })`.
- ✓ **CreateLabelForm** — 12-swatch grid (RTL: first colour on the
  right).
- ✓ **DeleteLabelDialog** — surfaces `affectedCardCount` (computed
  client-side from the local board store, since the server's
  separate count endpoint was out of scope).
- ✓ **CardItem update** — top 3 labels by position + "+N" badge for
  the rest. Wrapped in `React.memo` (R3 mitigation, pre-existing).
  Top-3 renders inline (not via the LabelBadge component) — see
  "Why CardItem doesn't import LabelBadge" below.
- ✓ **Replace the `card-detail/CardLabels.tsx` stub** with the new
  picker surface.

# Labels — F1.2.1.b UI Conventions

The boundaries linter (`apps/web/eslint.config.mjs`, severity `error`
since PR #46) enforces strict layering between `app`, `features/*`,
and `shared`. Two architectural choices below come straight from
respecting that linter, **not** from spec authorial intent — they're
the F1.2.1.b adjustment over the original featurelet plan.

## Component placement (D21)

The original spec placed every label component under
`apps/web/src/features/labels/components/`. The cross-feature ban
(`feature/A → feature/B`) blocked two import paths the spec implicitly
required:

  • CardItem (in `features/board`) needed the colour token map to
    render top-3 bars on the card preview.
  • CardLabels container (in `features/board/components/card-detail`)
    needed LabelPicker to open the picker popover.

Resolution: **hoist the cross-cutting pieces to `shared` territory.**

| File                          | Final location                          | Layer    |
|-------------------------------|-----------------------------------------|----------|
| tokenColorMap.ts              | `apps/web/src/lib/labels/`              | shared   |
| persianLabels.ts              | `apps/web/src/lib/labels/`              | shared   |
| LabelBadge.tsx                | `apps/web/src/components/labels/`       | shared   |
| CreateLabelForm.tsx           | `apps/web/src/components/labels/`       | shared   |
| LabelPicker.tsx               | `apps/web/src/components/labels/`       | shared   |
| LabelManager.tsx              | `apps/web/src/features/labels/components/` | feature |
| EditLabelForm.tsx             | `apps/web/src/features/labels/components/` | feature |
| DeleteLabelDialog.tsx         | `apps/web/src/features/labels/components/` | feature |
| LabelsTab.tsx (drawer)        | `apps/web/src/app/board/[boardId]/_components/` | app |
| CardLabels.tsx (card-detail)  | `apps/web/src/features/board/components/card-detail/` | feature (board) |

The split reads like this:
  • **shared** = pieces that any feature can render. The picker is
    used from BOTH the card-detail surface (board feature) and the
    manager (labels feature). LabelBadge is used by the picker. The
    create form is reused inside the manager too.
  • **features/labels** = manager-only components — the manager
    itself, the inline edit form, the delete dialog. Only the
    `LabelsTab` container in `app/` consumes them.
  • **features/board** = card-tier integration — the card-detail
    container that wraps the picker, and the CardItem update for
    the preview bars.
  • **app/** = drawer container (LabelsTab) — owns the labels.list
    query, derives counts from the board store, and wires the
    create/update/delete mutation hooks.

The convention from `settings-and-invitations.md` Section 10 already
sets this precedent: "When moving a label set into shared territory,
hoist it to `apps/web/src/lib/`."

## Why CardItem doesn't import LabelBadge

CardItem renders the top-3 bars **inline** (using `getTokenStyle`
from the shared `tokenColorMap`) instead of mounting `<LabelBadge
size="bar" />` for each bar. The runtime output is identical to
mounting the component, but the inline form has two structural wins:

  1. CardItem is a render-hot path (every card on the board re-renders
     on store updates). Skipping the per-bar function-component
     boundary trims a few microseconds per card per render.
  2. CardItem is in `features/board`. Importing LabelBadge from
     `@/components/labels/LabelBadge` is allowed (feature → shared),
     but inlining lets the file remain stylistically self-contained
     for the section reviewer who's reading the card-preview chunk
     end-to-end.

If you ever want a styling change to the bar shape, update both
`LabelBadge.tsx` (size="bar") AND the CardItem inline render. They
share the same `getTokenStyle` lookup, so colour changes auto-sync.

## Container vs presentational pattern

Every component in `@/components/labels/` and
`@/features/labels/components/` is **presentational** — no tRPC, no
mutation hooks, no store reads. They take props and call callbacks.

Containers (the wiring layer):

  • `features/board/components/card-detail/CardLabels.tsx` — owns
    the card-detail picker. Reads board labels via `trpc.label.list`,
    reads applied labels from the local store, calls
    `useAddCardLabel` / `useRemoveCardLabel` / `useCreateLabel`.
  • `app/board/[boardId]/_components/LabelsTab.tsx` — owns the
    drawer manager. Reads board labels via `trpc.label.list`,
    derives `affectedCardCounts` from the local store, calls
    `useCreateLabel` / `useUpdateLabel` / `useDeleteLabel`.

The presentational components stay reusable + unit-test-friendly;
the containers stay thin (~150 lines apiece).

## Role gate mirror (D8)

`LabelManager` accepts a `canManage: boolean` prop (`true` when
`role === "ADMIN" || role === "OWNER"`, set by the container).
When `false`:

  • The "+ افزودن برچسب" button is hidden.
  • Each row's edit / delete buttons are hidden.
  • The drag handle is hidden and `useSortable` is `disabled` so
    the row can't accidentally trigger a position update the
    server would reject anyway.
  • The header copy switches to a read-only explainer.
  • The empty-state CTA flips to a Persian "you need admin access"
    note (no create button).

The server still enforces D8 — `boardAdminProcedure` blocks
`label.delete` server-side even if the client sends the call. The
client gate is purely UX (no error toast for an action you couldn't
have triggered).

## Persian-aware case folding

Two surfaces fold to lowercase before comparing:

  • Picker search → `query.toLocaleLowerCase("fa-IR")` against each
    `label.name.toLocaleLowerCase("fa-IR")`. Mirrors the server's
    use-case fold in `createLabel.ts` so the local filter and a
    server duplicate-check return the same answer.
  • CreateLabelForm + EditLabelForm duplicate detection → same fold
    against `existingNames[]`.

The DB-level uniqueness index uses Postgres `LOWER()`, which agrees
with `toLocaleLowerCase("fa-IR")` for the dotted-i / Turkish-i quirks
that sometimes bite English+Persian text. Don't substitute
`String.prototype.toLowerCase()` — it diverges on Turkish locale and
will eventually let a duplicate slip past the client check.

## L keyboard shortcut

`CardLabels` (the card-detail container) registers a window-level
`keydown` listener for the `L` key. Two guards prevent surprises:

  1. Skip when focus is inside `<input>`, `<textarea>`, `<select>`,
     or any element with `[contenteditable]="true"`. Otherwise typing
     "label" or "L" anywhere in the card title would open the picker.
  2. Skip when any modifier is held (`Ctrl` / `Meta` / `Alt`) so the
     shortcut doesn't collide with browser navigation.

The trigger button has `aria-label="افزودن برچسب (کلید L)"` so the
shortcut is discoverable from the screen reader without adding a
visual hint.

## CSS token map invariants

`apps/web/src/lib/labels/tokenColorMap.ts` is the single source of
truth for how a `ColorToken` renders. Each entry exposes
`{ bg, text, persianName }`:

  • `bg` matches Tailwind's 500-stop hex for nine of the twelve
    tokens. `brown.500 → amber-800` and `black → slate-800` are
    the two hand-picked exceptions documented inline in that file.
  • `text` is `slate-900` for `yellow.500` (the only token bright
    enough to fail WCAG AA against white) and `white` everywhere
    else. Re-check this decision against
    https://webaim.org/resources/contrastchecker/ if you ever
    change a `bg` value.
  • `persianName` is read from `persianLabels.ts` (a copy of the
    canonical `COLOR_TOKEN_LABELS_FA` from `@repo/domain` —
    runtime imports of `@repo/domain` are blocked from
    `apps/web/src/{features,components}/**`, so the duplicate lives
    in `lib/labels/` per architecture.md's type-only carveout).

Adding a token is a five-step migration:
  1. `packages/domain/src/labels/types.ts` → COLOR_TOKENS +
     COLOR_TOKEN_LABELS_FA.
  2. `packages/db/src/schema/labels.ts` → Drizzle `check()`.
  3. New SQL migration extending `labels_color_token_check`.
  4. `apps/web/src/lib/labels/persianLabels.ts` → mirror.
  5. `apps/web/src/lib/labels/tokenColorMap.ts` → add the `bg`
     hex + decide the `text` foreground (run contrast check).

Skipping any of these surfaces a runtime CHECK violation on the
next `label.create` with the new colour, or a fallback grey from
`getTokenStyle`'s defensive lookup.
