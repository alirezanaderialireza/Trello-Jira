---
inclusion: always
---

# Checklists — Phase 1.2 (F1.2.3.a) Conventions

Persistence, domain, API, and event-payload rules for the checklists
feature. Mirrors `labels-conventions.md` so the next card-feature PR
has a single template to copy.

## Schema (migration `0009_phase1.2_checklists.sql`)

Two tables, both tenant-scoped, both rebuilt from the Phase 0.x
stubs (`name → title`, `completed → is_done`, integer position →
LexoRank, audit columns added, `tenant_id` denormalised on items).
The rebuild was data-equivalent: the previous router was unreachable
from any production traffic (raw `protectedProcedure`, no outbox,
referenced an undeclared Drizzle relation that would crash on first
call).

`checklists`
- `title varchar(100)` — replaces `name varchar(128)` per D7.
- `position varchar(255)` — LexoRank string. Generated client-side
  via `@repo/domain/ordering → generatePosition` for offline-friendly
  optimistic insert; server validates on write.
- `created_by uuid → users(id) NOT NULL` + `updated_at` — audit trail
  used by the activity timeline (F1.2.6).
- Unique partial index on `(card_id, LOWER(title))` WHERE
  `deleted_at IS NULL` — case-insensitive uniqueness for live
  checklists per card (D5). LOWER() is IMMUTABLE → safe in the
  partial-index predicate (Phase 0 L1 lesson).
- RLS split per command (SELECT/INSERT/UPDATE/DELETE) with active
  `board_members` EXISTS predicate (mirrors labels in 0007). Three
  layers: router membership guard, RLS membership EXISTS, RLS tenant
  filter.

`checklist_items`
- `text varchar(500)` — replaces `title varchar(255)` per D6 to
  accommodate sentence-length acceptance criteria.
- `is_done boolean` — replaces `completed` for spec clarity (D8).
- `position varchar(255)` — LexoRank for D11 reorder.
- `tenant_id` is denormalised — RLS predicate is a pure index lookup
  instead of a JOIN to checklists. Defended by:
  1. Application code: the checklists router always inserts the
     `tenantId` from `ctx.session`, never from input.
  2. RLS WITH CHECK on INSERT: `tenant_id = current_tenant_id()`.
- `created_by` + `updated_at` — audit trail.
- RLS keeps a tenant-only check (no `board_members` EXISTS) — the
  items are reachable only through `checklists` which already
  enforces membership. Duplicating the predicate would force a
  four-table planner shape with no security benefit (mirrors labels'
  `card_labels` rationale).

## Domain (`packages/domain/src/checklists`)

### Entities
```ts
export interface ChecklistEntity {
  id, tenantId, cardId, boardId, title, position,
  createdAt, createdBy, updatedAt, deletedAt;
}
export interface ChecklistItemEntity {
  id, tenantId, checklistId, text, isDone, position,
  createdAt, createdBy, updatedAt;
}
```
`ChecklistId` and `ChecklistItemId` are branded; events carry plain
`string`s and the repository re-applies brands at the boundary.

### Use cases (5 pure functions)
- `createChecklist`     — validate title, fa-IR fold for duplicate,
                           build entity + event.
- `updateChecklist`     — D12 (rename + reorder via field mask;
                           returns `{ noOp: true } | { noOp: false; … }`).
- `deleteChecklist`     — accepts pre-resolved `affectedItemCount`.
- `addChecklistItem`    — validate text, build item entity + event.
- `updateChecklistItem` — D10 toggle / D11 reorder / rename via field
                           mask. Single procedure handles all three
                           concerns (no separate toggle endpoint —
                           "isDone is just a field").
- `removeChecklistItem` — produces removed event; repo hard-deletes.

All use cases are pure: no DB, no clock, no random IDs. Side effects
live in the router. Discriminated-union output for the no-op path so
the router branches without sentinel checks.

### Errors
Nine typed error classes mapped to `TRPCError` via `toTRPCError` in
the router:

| Error | TRPCError code | Persian message |
|---|---|---|
| ChecklistTitleRequiredError | BAD_REQUEST | عنوان چک‌لیست الزامی است. |
| ChecklistTitleTooLongError | BAD_REQUEST | عنوان چک‌لیست نباید از ۱۰۰ نویسه بیشتر باشد. |
| DuplicateChecklistTitleError | CONFLICT | این عنوان چک‌لیست قبلاً در این کارت وجود دارد. |
| ChecklistItemTextRequiredError | BAD_REQUEST | متن مورد الزامی است. |
| ChecklistItemTextTooLongError | BAD_REQUEST | متن مورد نباید از ۵۰۰ نویسه بیشتر باشد. |
| ChecklistNotFoundError | NOT_FOUND | چک‌لیست یافت نشد. |
| ChecklistItemNotFoundError | NOT_FOUND | مورد چک‌لیست یافت نشد. |
| CardNotFoundError | NOT_FOUND | کارت یافت نشد. |
| ChecklistCardMismatchError | BAD_REQUEST | چک‌لیست به این کارت تعلق ندارد. |

## Events (schema version 2)

Six event types, all carrying `schemaVersion: 2`. TYPE strings stay
snake_case-with-underscore (`checklist.item_added` etc.) — same
convention as F1.2.1's `card.label_added` and matching the existing
client dispatcher / reducers. The spec D8 examples used dot-separated
sub-segments (`checklist.item.added`); we keep the underscore form
for project-wide consistency. Documented as **D8 reconciliation** in
the F1.2.3.a PR description.

| Type                       | Aggregate | Payload v2 fields |
|----------------------------|-----------|-------------------|
| `checklist.created`        | card      | checklistId, cardId, boardId, **title**, **position**, **createdBy** |
| `checklist.updated`        | card      | checklistId, cardId, boardId, changes(title?, position?) |
| `checklist.deleted`        | card      | checklistId, cardId, boardId, **affectedItemCount** |
| `checklist.item_added`     | card      | checklistItemId, checklistId, cardId, boardId, **text**, **isDone**, **position**, **addedBy** |
| `checklist.item_updated`   | card      | checklistItemId, checklistId, cardId, boardId, changes(**text**?, **isDone**?, **position**?) |
| `checklist.item_removed`   | card      | checklistItemId, checklistId, cardId, boardId |

There is **no v1 backward-compat payload**. The Phase 4 stubs never
went through the outbox pipeline (router used raw `protectedProcedure`
and emitted nothing), so consumers can hard-require schemaVersion 2
fields.

## API (`packages/api/src/routers/card-features/checklists.router.ts`)

Eight procedures, mounted at `v1.public.checklist.*` (singular —
matches the existing root mount in `packages/api/src/index.ts`):

```
v1.public.checklist.list({ boardId, cardId })                       → ChecklistDto[]
v1.public.checklist.listItems({ boardId, checklistId })             → ChecklistItemDto[]
v1.public.checklist.create({ boardId, cardId, title, idempotencyKey }) → ChecklistDto
v1.public.checklist.updateChecklist({ boardId, checklistId, title?, position?, idempotencyKey }) → { success, noOp }
v1.public.checklist.deleteChecklist({ boardId, checklistId, idempotencyKey }) → { success, affectedItemCount }
v1.public.checklist.addItem({ boardId, checklistId, text, idempotencyKey })   → ChecklistItemDto
v1.public.checklist.updateItem({ boardId, checklistItemId, text?, isDone?, position?, idempotencyKey }) → { success, noOp }
v1.public.checklist.removeItem({ boardId, checklistItemId, idempotencyKey }) → { success }
```

### Authorisation (D13)
| Action | Procedure | Extra check |
|---|---|---|
| list / listItems / create / addItem / updateItem / removeItem / updateChecklist | `boardProtectedProcedure` | — |
| deleteChecklist | `boardProtectedProcedure` | inline: creator OR admin/owner (mirrors labels.update) |

No new F2 builder is added (Master Contract L9). The `creator OR
admin` rule isn't a pure role assertion so it doesn't fit
`boardAdminProcedure`.

### Atomic outbox + idempotency

Every mutation uses the same skeleton (mirrors labels.router):

```
mutation: boardProtectedProcedure.input(…).mutation(({ input, ctx }) =>
  withIdempotency(ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey, async () => {
    const repo = new DrizzleChecklistsRepository(ctx.infra.db);
    // 1. read prerequisites (card, parent checklist, siblings) from repo
    // 2. run the pure use case
    // 3. await repo.<write>(ctx.infra.db, …)
    // 4. await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(event))
    // 5. return response (cached by withIdempotency)
  })
)
```

- `idempotencyKey` is required on every mutation (`uuid` schema).
- The atomic-outbox guarantee depends on **both** the repository write
  and `ctx.repos.outbox.append` running on `ctx.infra.db`.
  `tenantContextMiddleware` already opens that tx; nothing else needs
  to compose.
- `withIdempotency` is a local copy of the same helper from
  labels.router — Master Contract Rule 4 keeps the hoist out of scope
  for this cycle. Both copies share shape so a future shared
  extraction can replace both.

### Topology guards (R9 defence-in-depth)
RLS already prevents cross-tenant card / checklist reads, but the
`boardMemberGuard` validates membership on `input.boardId`, not on the
target row's actual `boardId`. Every mutation re-checks
`row.boardId === input.boardId` and fails with `BAD_REQUEST` /
`ChecklistCardMismatchError` on divergence — same pattern as labels.

## Web (`apps/web/`)

### DTOs (Zustand store)
```ts
ChecklistDto: { id, cardId, boardId, title, position, items[], revision, isOptimistic? }
ChecklistItemDto: { id, text, isDone, position }
```

### Reducer (`event-application/applyChecklist.ts`)
Reads v2 payloads. Six reducers wired to the dispatcher (one per event
type). `oldX` and `actor*` fields on payloads are ignored at the
store level — they're for the activity timeline (F1.2.6).

### Mutation hooks (5 hooks under `mutations/checklists/`)
- `useCreateChecklist({ cardId, boardId, title, correlationId })`
- `useDeleteChecklist({ checklistId, cardId, boardId, correlationId })`
- `useAddChecklistItem({ checklistId, cardId, boardId, text, correlationId })`
- `useUpdateChecklistItem({ checklistId, checklistItemId, cardId, boardId, text?, isDone?, position?, correlationId })`
- `useRemoveChecklistItem({ checklistId, checklistItemId, cardId, boardId, correlationId })`

All five send `idempotencyKey` (= correlationId reuse) to the server;
optimistic envelopes mirror the v2 server payload shape. `addedBy` /
`createdBy` placeholders are empty strings — server reconciles via
the live event within ~50ms and no reducer reads them for state
derivation.

### boardApi facade
Six methods aligned to the new router contract:
- `createChecklist({ cardId, boardId, title, idempotencyKey, correlationId? })`
- `updateChecklist({ checklistId, boardId, title?, position?, idempotencyKey, correlationId? })`
- `deleteChecklist({ checklistId, boardId, idempotencyKey, correlationId? })`
- `addChecklistItem({ checklistId, boardId, text, idempotencyKey, correlationId? })`
- `updateChecklistItem({ checklistItemId, boardId, text?, isDone?, position?, idempotencyKey, correlationId? })`
- `removeChecklistItem({ checklistItemId, boardId, idempotencyKey, correlationId? })`

## Don't

- **Don't** read `payload.name` or `item.title` on a checklist event —
  v2 renamed them to `title` and `text` respectively.
- **Don't** read `payload.completed` on items — v2 renamed to `isDone`.
- **Don't** call the wire procedure `v1.public.checklist.delete` — v2
  renamed to `deleteChecklist` so it pairs with `updateChecklist`.
- **Don't** insert into `checklists` or `checklist_items` directly
  (bypassing the router) — the boardId / tenantId provenance and the
  audit columns are populated by the router from `ctx.session`.
- **Don't** hard-delete a checklist. Soft-delete (`deleted_at = now()`)
  preserves the activity timeline; items are hard-deleted in the same
  tx (junction-like — no business state worth retaining).
- **Don't** trust client-supplied `tenantId` or `createdBy` /
  `addedBy` — the router always populates these from `ctx.session`.
- **Don't** rely on the `cardId` / `boardId` field of a checklist
  being writable — checklists can't move between cards or boards
  (would require a separate procedure with its own outbox event).

## F1.2.3.b checklist (UI — ✅ shipped)

All items shipped in F1.2.3.b.

- ✅ **useUpdateChecklist** — new hook in
  `features/board/store/mutations/checklists/useUpdateChecklist.ts`.
  Mirrors `useUpdateChecklistItem` exactly. Used for:
  (a) inline rename of checklist title; (b) drag-and-drop reorder
  of checklists within a card.
- ✅ **ChecklistItemRow** — toggle `isDone`, inline rename `text`,
  drag handle (position reorder), trash delete. Lives in
  `features/board/components/card-detail/checklists/`.
- ✅ **InlineAddItem** — "افزودن مورد" input with focus retention
  after add (Trello-style multiple-add UX), Enter/Esc handling,
  500-char client validation. Lives in same folder.
- ✅ **DeleteChecklistDialog** — type-name-to-confirm modal,
  `affectedItemCount` in Persian numerals, Escape/backdrop/X close,
  fa-IR fold match. Lives in same folder.
- ✅ **ChecklistRow** — inline title rename with duplicate check
  (fa-IR fold), progress bar (done/total, Persian numerals), delete
  button gated on `canDelete` (admin/owner), `@dnd-kit/sortable`
  for items. Lives in same folder.
- ✅ **ChecklistManager** — sortable checklist list with
  `@dnd-kit/sortable`, add-checklist form with duplicate validation,
  empty state, `DeleteChecklistDialog` wired. Lives in same folder.
- ✅ **CardChecklists** (full rewrite) — replaces broken stub; tRPC
  `checklist.list` + `checklist.listItems` per checklist, Zustand
  store hydrated on success, subsequent reads from store. Accepts
  `viewerId` + `viewerRole` for delete gating. Lives in
  `features/board/components/card-detail/CardChecklists.tsx`.
- ✅ **ChecklistProgressBadge** — shared badge (`components/cards/`)
  showing `done/total` in Persian numerals. Shows only when
  `total > 0`. Consumed by `CardItem` via atomic store selector.
- ✅ **CardItem** updated — atomic `makeSelectChecklistProgress`
  selector; renders `<ChecklistProgressBadge>` when `total > 0`.

# F1.2.3.b UI Conventions

## Component placement (T8 / D21 repeat)

Same resolution as labels (D21): components consumed by
`CardItem` (features/board) must live in **shared** territory
because the boundaries linter blocks feature→feature imports.

| File | Location | Layer |
|---|---|---|
| `ChecklistItemRow.tsx` | `features/board/components/card-detail/checklists/` | feature (board) |
| `InlineAddItem.tsx` | same | feature (board) |
| `DeleteChecklistDialog.tsx` | same | feature (board) |
| `ChecklistRow.tsx` | same | feature (board) |
| `ChecklistManager.tsx` | same | feature (board) |
| `CardChecklists.tsx` | `features/board/components/card-detail/` | feature (board) |
| `ChecklistProgressBadge.tsx` | `components/cards/` | **shared** |

The four components in `features/board` use mutation hooks directly
and therefore cannot be shared. Only the read-only badge that
`CardItem` needs is in shared territory.

## New hook: useUpdateChecklist

`useUpdateChecklist` wraps `boardApi.updateChecklist` with the same
optimistic-mutation pattern as `useUpdateChecklistItem`. Field mask:
`title?` / `position?`. Required by both the inline title rename
(ChecklistRow) and the drag-and-drop checklist reorder
(ChecklistManager).

## T7 hydration decision: separate listItems per checklist

`checklist.list` returns checklists **without** items.
`checklist.listItems` returns items for a single checklist.

Choice made in `CardChecklists.tsx`: fetch checklists first, then
`useQueries` to fetch all items in parallel (one query per checklist,
React Query coordinates). Both results are written into the Zustand
store via synthetic event envelopes on success.

Rationale:
- Keeps the server contract clean (no forced nesting).
- Avoids adding a new `listWithItems` procedure for a small UI feature.
- After hydration, all state reads go through the store — no
  re-fetching on every toggle / rename / drag.
- `staleTime: 30_000` on both queries; real-time updates come via WS.

## ChecklistProgressBadge format

- Icon: `CheckSquare` (lucide-react), h-3 w-3.
- Text: `done/total` in Persian numerals (`toLocaleString("fa-IR")`).
- Palette: `bg-emerald-900/50 text-emerald-400` when `done === total`,
  `bg-slate-700 text-slate-400` otherwise.
- Hidden when `total === 0` (component returns `null`).

## Progress bar format (ChecklistRow)

- `done / total * 100`, rounded to integer percent.
- ARIA: `role="progressbar"`, `aria-valuenow`, label in Persian.
- Color: `bg-emerald-500` fill over `bg-slate-700` track.

## Parked follow-ups (unchanged)

- **Activity timeline integration** → Phase 1.2.8 (payloads ready).
- **Bulk reorder** → Phase 1.2 polish.
- **Item count limit** → Phase 1.5 (rebalance worker).
- **E2E spec** → Phase 1.4.

## Parked follow-ups

- **Bulk reorder of multiple items** in one mutation (Phase 1.2
  polish) — currently each reorder is one `updateItem` call.
- **Item count limit per checklist** — no enforced limit; rely on
  LexoRank rebalance worker (Phase 1.5) to handle long-running
  collisions.
- **Activity timeline** — the v2 event payloads already carry every
  field the projection needs (oldX/newX where applicable, +actor),
  so F1.2.8 can wire the projection without a payload bump.
- **Accounting-data JSONB cleanup** — N/A here; the checklists stubs
  didn't pollute that column.
- **E2E spec** — Phase 1.4 (per F5c precedent: predictive specs
  before UI verification cause CI churn).

## Adding a similar two-table aggregate (template)

Captured here for the next featurelet (Phase 1.2.4 Comments will
follow a similar shape — comments + reactions or threading):

1. Migration `NNNN_phaseXY_<topic>.sql` — DROP/CREATE if drift,
   ALTER if not. Idempotent with `IF NOT EXISTS`.
2. Drizzle schema mirroring the migration (`schema/<topic>.ts`),
   re-exported via `schema/index.ts`.
3. Domain slice under `domain/src/<topic>/`:
   types (branded IDs + entities + repository port), errors,
   use-cases (one per command), `__tests__/`, `index.ts` barrel.
4. Domain events with schemaVersion 2 in
   `domain/src/events/<topic>.events.ts`.
5. `DrizzleXRepository` in `db/src/repositories/`, wired into
   `db/src/index.ts` as a singleton.
6. Router in `api/src/routers/card-features/<topic>.router.ts` —
   boardProtectedProcedure + atomic outbox + idempotency, topology
   guards, Persian error messages.
7. CardDto field (if needed) + reducer + DTO + mutation hooks +
   boardApi facade in apps/web.
8. Steering doc (this file's pattern).
