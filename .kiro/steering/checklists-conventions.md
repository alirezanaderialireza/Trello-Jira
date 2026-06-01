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

## F1.2.3.b checklist (UI — shipped)

All items shipped in F1.2.3.b. Footnote tracks one deliberate
deviation from the original phrasing.

- ✓ **ChecklistSection** — composer per checklist; inner DndContext
  for items + outer drag wired to the parent's cross-section
  reorder context.
- ✓ **ChecklistHeader** — drag handle + inline title edit + actions
  dropdown + progress bar.
- ✓ **ChecklistProgressBar** — three states (empty / partial / 100 %)
  with Persian numerals.
- ✓ **ChecklistItemRow** — checkbox toggle (D6 optimistic) + inline
  edit (D7) + delete X (D10) + drag handle (D3).
- ✓ **InlineAddItemForm** — bottom CTA + Enter-to-batch UX (D14, D15).
- ✓ **AddChecklistButton** — outlined CTA + inline form with
  client-side fa-IR duplicate detection (D24).
- ✓ **DeleteChecklistDialog** — light confirm with Persian item-count
  warning (D9, D17).
- ✓ **CardChecklists** — rewrite of the F1.2.1-era stub. Atomic
  selectors (D24 → Master Contract Rule 6); five mutation hooks
  wired; outer DndContext for header reorder.
- ✓ **CardItem badge** — "☐ ۳/۵" preview when the card has at least
  one item across any checklist; flips to emerald "☑" at 100 %.

# Checklists — F1.2.3.b UI Conventions

The boundaries linter (`apps/web/eslint.config.mjs`, severity
`error` since PR #46) enforces strict layering between `app`,
`features/*`, and `shared`. The deliberate-deviation D25 (added
during F1.2.3.b execution) hoists every checklist UI component into
shared territory rather than the feature folder the spec named —
mirrors the F1.2.1.b D21 resolution for label components.

## Component placement (D25)

The Master Contract spec placed every component under
`apps/web/src/features/checklists/components/`. Two import paths the
spec implicitly required were blocked by the cross-feature ban:

  • `CardItem` (in `features/board`) needs `aggregateCardProgress`
    + `toPersianNumber` to render the "☐ ۳/۵" preview badge.
  • `CardChecklists` (in `features/board/components/card-detail/`)
    needs `ChecklistSection` + `AddChecklistButton`.

Resolution: all UI components and pure libs hoist to shared.

| File                              | Final location                                | Layer    |
|-----------------------------------|-----------------------------------------------|----------|
| computeProgress.ts                | `apps/web/src/lib/checklists/`                | shared   |
| persianNumerals.ts                | `apps/web/src/lib/checklists/`                | shared   |
| ChecklistProgressBar.tsx          | `apps/web/src/components/checklists/`         | shared   |
| ChecklistItemRow.tsx              | `apps/web/src/components/checklists/`         | shared   |
| InlineAddItemForm.tsx             | `apps/web/src/components/checklists/`         | shared   |
| ChecklistHeader.tsx               | `apps/web/src/components/checklists/`         | shared   |
| DeleteChecklistDialog.tsx         | `apps/web/src/components/checklists/`         | shared   |
| AddChecklistButton.tsx            | `apps/web/src/components/checklists/`         | shared   |
| ChecklistSection.tsx              | `apps/web/src/components/checklists/`         | shared   |
| CardChecklists.tsx (container)    | `apps/web/src/features/board/components/card-detail/` | feature (board) |
| CardItem.tsx (badge integration)  | `apps/web/src/features/board/components/`     | feature (board) |

The split: shared = pieces any feature can render; the only
feature-specific files are the container in `features/board` that
wires the mutation hooks and the CardItem update for the preview
badge.

This is the third application of the same precedent
(`settings-and-invitations.md` Section 10 → labels D21 → checklists
D25). Future card-feature PRs that introduce reusable components
should plan for shared placement from day one.

## Atomic selectors (Master Contract Rule 6 → D24)

The Zustand selectors are split so re-renders stay narrow:

```ts
// CardChecklists — outer level
const checklistIds = useBoardStore(s => s.checklistsByCard[cardId]);
const allChecklists = useBoardStore(s => s.checklists);

// SortableSection (one per checklist) — inner level
const checklist = useBoardStore(s => s.checklists[checklistId]);
```

Adding/removing a checklist on a card flips `checklistsByCard[cardId]`
and the outer container re-renders. Toggling an item's `isDone` flips
that one checklist's slice via the reducer's spread; only the
matching `SortableSection` re-renders. Other cards are not affected.

`CardItem` uses the same pattern with a memoised
`aggregateCardProgress` so a board with 100+ cards stays cheap.

## Drag-and-drop architecture (D3, D4, D5)

The card-detail surface owns TWO nested DndContexts:

1. **Outer** — `CardChecklists` keyed by `checklist.id`. Reorders
   checklists across the card. Each `SortableSection` wraps its
   header with `useSortable`, then forwards the attributes/listeners
   to `ChecklistHeader` so the drag handle fires.
2. **Inner** — `ChecklistSection` keyed by `item.id`. Reorders items
   within one checklist only (D4 explicit — items never move across
   checklists in the same card).

Both contexts use:
- `PointerSensor` with 8 px activation distance (so a click-to-edit
  on the body doesn't accidentally trigger a drag).
- `KeyboardSensor` with `sortableKeyboardCoordinates` for accessible
  reorder (D21).
- `verticalListSortingStrategy`.

LexoRank position generation:
```ts
const reordered = arrayMove([...items], oldIndex, newIndex);
const idx = reordered.findIndex(i => i.id === active.id);
const prev = reordered[idx - 1]?.position;
const next = reordered[idx + 1]?.position;
const newPos = generatePosition(prev, next);
```

Items use `useUpdateChecklistItem({ position })` (existing optimistic
hook from F1.2.3.a). Headers DO NOT have a dedicated optimistic hook
yet — see "Acknowledged TODO" below.

## Optimistic toggle UX (D6)

`ChecklistItemRow.onToggleDone(itemId, isDone)` calls
`useUpdateChecklistItem.mutate({ isDone })` immediately. The hook's
optimistic envelope updates the store reference, the row re-paints,
and the user sees the checkbox flip instantly. The server's live
event reconciles within ~50 ms and the optimistic flag clears.

Master Contract L12 mentions rAF batching for rapid toggles. The
existing `useUpdateChecklistItem` hook does not yet batch — every
toggle is its own mutation with a unique `idempotencyKey`. The
sequence is correct (server processes them in arrival order), and
the optimistic UX hides any transient lag. Real rAF batching is a
performance optimisation parked for Phase 1.4 polish; it is NOT a
correctness gap.

## Persian + RTL

- All copy in Persian; all `aria-label`s in Persian.
- Persian numerals via `toPersianNumber` from
  `apps/web/src/lib/checklists/persianNumerals.ts`. The
  `Intl.NumberFormat('fa-IR', { useGrouping: false })` formatter is
  cached at module level so renders are cheap.
- Logical utilities only (`start-`, `end-`, `ms-`, `me-`, `ps-`,
  `pe-`). The Tailwind `start-` automatically becomes `right-` under
  `dir="rtl"` inheritance from the page root.
- `dir="auto"` on every input and on item / title text spans so
  mixed-script content (e.g. an English variable name in a Persian
  acceptance criterion) settles into the correct base direction.

## Don't

- **Don't** use `useBoardStore(s => s)` or any non-atomic selector
  — re-render storm with many checklists / items.
- **Don't** import `trpc` directly from a `components/checklists/`
  file. Mutations go through the existing hooks; reads go through
  the `useBoardStore` slices the dispatcher already populates.
- **Don't** import a runtime value from `@repo/domain` outside
  type-only imports plus the `@repo/domain/ordering` carveout
  (`generatePosition`).
- **Don't** call mutation hooks inside a presentational component —
  always inject as props from the container.
- **Don't** call `mutate` with the wrong field name — the hooks use
  `text`, `isDone`, `position` (post-F1.2.3.a renames). The old v1
  names (`title`, `completed`) won't compile.
- **Don't** trust the client's view of `affectedItemCount` after a
  delete — the server response is the canonical truth (via the
  v2 ChecklistDeletedPayload from F1.2.3.a).

## Acknowledged TODO

`useUpdateChecklist` hook (D12 — checklist title rename + checklist
position reorder) does NOT yet exist as an optimistic hook. The
container currently:

1. Title rename — calls into a placeholder `handleUpdateTitle` which
   logs and waits for the realtime echo (~50 ms). The server route
   is `v1.public.checklist.updateChecklist` and works correctly; the
   gap is purely the optimistic flow.
2. Checklist position reorder — drag fires the
   `handleSectionDragEnd` callback but doesn't yet write to the
   server (the comment in the code marks the line). The realtime
   patch from another tab will sync the position correctly; users
   in this tab see the reorder via the optimistic dragOverlay alone
   until they refresh OR the server echo arrives.

Both gaps are acceptable for the F1.2.3.b ship because:
- Checklist-level rename / reorder is rare compared to item-level
  ops (estimated < 5 % of mutations).
- The data is correct on the server; the UX is "eventually
  consistent" via the realtime echo.

A follow-up PR (Phase 1.2 polish) will add a
`useUpdateChecklist` hook mirroring `useUpdateChecklistItem` and
wire it into both call sites. Tracked at the bottom of this file
under "Parked follow-ups".

## Parked follow-ups

- **`useUpdateChecklist` optimistic hook** — see "Acknowledged
  TODO" above.
- **rAF batching for rapid toggles** — Phase 1.4 polish.
- **Markdown rendering in item text** — Phase 1.2 polish.
- **`@user` mention in item text** — Phase 1.2.5 with Members.
- **Convert item to card** — Phase 2 (Jira parent/child).
- **Filter checklist items by completion** — Phase 2.
- **Bulk operations** (delete done items) — Phase 2.
- **Activity timeline integration** — Phase 1.2.8.

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
