---
inclusion: always
---

# Card Due Date — Phase 1.2 (F1.2.2) Conventions

Persistence, domain, and UI rules for the card due-date feature.
Mirrors the labels-conventions structure so a future card-feature
PR has a single template to copy.

## Time engine doctrine (non-negotiable)

`apps/web/src/lib/date.ts` is the project-wide time engine. **No file
outside `lib/date.ts` may import `dayjs` or `jalaliday` directly** —
the ESLint `no-restricted-imports` rule (Phase 0.1) enforces this.
For due-date specifically:

  • **Storage:** `cards.due_date DATE NULL`. NOT `TIMESTAMPTZ`. A due
    date is a wall-clock fact ("the card must be done by March 30"),
    NOT an instant in time. TIMESTAMPTZ would silently flip "March 30"
    to "March 29" for users east of UTC+0; DATE is timezone-agnostic
    and matches the Master Plan section 8 doctrine.
  • **Domain wire format:** `DateOnly` — branded `string` of shape
    `YYYY-MM-DD`. Brand declared identically in
    `packages/domain/src/shared/date-types.ts` and
    `apps/web/src/lib/date.ts`. TS treats them as compatible because
    they share the brand string.
  • **Logic:** all comparisons go through helpers in `lib/date.ts`
    (`isOverdue`, `toDateOnlyUTC`, `toJalaliDisplay`,
    `fromJalaliInput`). **Never** `new Date()` against a `DateOnly`.
  • **Display:** `toJalaliDisplay(date, getUserTZ(), format)` only at
    render time — never store a Jalali string.
  • **Parse user input:** `fromJalaliInput(text)` returns a
    `ParseResult<DateOnly>`; never throws. On `ok: false`, surface a
    Persian error inline.

## Schema (`migration 0008_phase1.2_due_date.sql`)

```sql
ALTER TABLE "cards"
  ADD COLUMN IF NOT EXISTS "due_date" date;

CREATE INDEX IF NOT EXISTS "idx_cards_due_date"
  ON "cards" ("tenant_id", "due_date")
  WHERE "due_date" IS NOT NULL
    AND "deleted_at" IS NULL;
```

  • **NULL allowed.** Cards default to no due date.
  • **No backfill from `accounting_data`.** The pre-F1.2.2 stub stored
    ISO datetimes in JSONB; truncating those to a DATE would silently
    flip Tehran-tomorrow to Tehran-today. The PR header documents the
    audit; cleanup of the stale JSONB key is parked for the Phase 1.5
    janitor.
  • **Partial index** for the upcoming overdue/due-today sweeps. The
    predicate uses only `IS NOT NULL` and `IS NULL` (immutable) — no
    `now()` or `CURRENT_DATE` in the predicate (Phase 0 L1 lesson).
  • **RLS unchanged.** RLS evaluates rows, not columns; the existing
    `cards_tenant_*` policies (0002 / 0004) cover the new column.

## Domain (`packages/domain/src/card`)

### Card entity
```ts
export interface Card {
  // …existing fields…
  dueDate: DateOnly | null;
}
```

### Use case `setCardDueDate`
Pure function — no DB, no clock, no random IDs. Returns a discriminated
union so the router can branch without sentinel checks:

```ts
export type SetCardDueDateOutput =
  | { readonly noOp: true }
  | {
      readonly noOp:  false;
      readonly patch: { readonly dueDate: DateOnly | null };
      readonly event: CardDueDateUpdatedEvent;
    };
```

Idempotency at the use-case layer: when `card.dueDate === newDueDate`
the use case returns `{ noOp: true }`. The router skips both the DB
write and the outbox emit on no-op (defends against realtime echo
driving the same change back into the system).

### Event v2 — `card.due_date_updated`

```ts
interface CardDueDateUpdatedPayload {
  cardId:     string;
  boardId:    string;
  oldDueDate: string | null;  // YYYY-MM-DD
  newDueDate: string | null;  // YYYY-MM-DD
  updatedBy:  string;          // userId
}
// schemaVersion: 2 on every emit
```

There is **no v1 backward-compat payload**. The pre-F1.2.2 stub stored
due dates in `cards.accounting_data` JSONB and never went through the
outbox pipeline, so consumers can hard-require schemaVersion 2 fields.

## API (`packages/api/src/routers/card-features/due-date.router.ts`)

```
v1.public.dueDate.setDueDate({
  cardId:         uuid,
  boardId:        uuid,             // required by boardMemberGuard
  dueDate:        "YYYY-MM-DD" | null,
  idempotencyKey: uuid,
  correlationId?: string,
}) → { success, noOp, dueDate }
```

  • **Procedure:** `boardProtectedProcedure` — any board member may
    set or clear (D6).
  • **Topology guard:** the handler verifies
    `cardRow.boardId === input.boardId` and fails with `BAD_REQUEST`
    if they diverge. RLS is the second layer.
  • **Atomic outbox:** the `cards.due_date` UPDATE and
    `outbox.append` run on the same `ctx.infra.db` (the RLS-enforced
    tx the `tenantContextMiddleware` opens).
  • **Idempotency:** `withIdempotency` wraps the handler. On replay
    the cached response is returned without re-executing.
  • **No-op short-circuit:** when the use case returns `{ noOp: true }`
    the router returns `{ success: true, noOp: true, dueDate: current }`
    and skips both DB write and outbox emit.
  • **Persian error messages:**
    - `NOT_FOUND` → "کارت یافت نشد."
    - `BAD_REQUEST` (topology) → "کارت به این برد تعلق ندارد."

## Web (`apps/web/`)

### CardDto (Zustand store)
`dueDate?: string | null` — wire shape (`YYYY-MM-DD` or null). Comment
calls out the wire format. The runtime type stays `string | null` so
no downstream consumer breaks; a future tightening to `DateOnly | null`
would be a no-op at runtime.

### Reducer (`event-application/applyCardDueDate.ts`)
Reads `payload.newDueDate` (the v2 post-mutation value) and writes it
onto `card.dueDate`. `oldDueDate` and `updatedBy` are ignored at the
store level — they're for the activity timeline projection (F1.2.6).

### Mutation hook (`mutations/cards/useUpdateCardDueDate.ts`)
`useUpdateCardDueDate({ cardId, boardId, dueDate, correlationId })`.
Optimistic envelope mirrors the v2 server payload (`oldDueDate` from
local snapshot, `newDueDate` from input, `updatedBy` placeholder).
The server reconciles via the live event within ~50ms.

### boardApi facade
`boardApi.setCardDueDate({ cardId, boardId, dueDate, idempotencyKey,
correlationId? })` targets `v1.public.dueDate.setDueDate`. The
deprecated `boardApi.updateCardDueDate` is kept as an explicit-throw
shim so any uncaught caller in dev branches surfaces a clear error
instead of a silent 404; will be removed in F1.2.3 once call sites are
audited.

## UI Conventions

### Component placement (D21 redux)
`CardDueDateBadge` lives in `apps/web/src/components/cards/` (shared)
because two consumers from different feature folders need it:

  • `CardItem` in `features/board` — top of the preview, when
    `dueDate` is set.
  • `CardDueDate` in `features/board/components/card-detail` — same
    surface, larger size.

Cross-feature imports (`features/board → features/cards`) are blocked
by the boundaries linter (PR #46, error severity). The hoist mirrors
the F1.2.1.b D21 resolution for `LabelBadge`.

### Variant palette (D8/D9/D10)
| State    | Tailwind classes                                    | Rationale |
|----------|-----------------------------------------------------|-----------|
| overdue  | text-red-700 bg-red-50 border-red-200               | Critical attention; matches the destructive-action palette |
| today    | text-amber-700 bg-amber-50 border-amber-200         | Action-required-soon; matches the unconfirmed-action palette |
| future   | text-slate-700 bg-slate-100 border-slate-200        | Informational only; matches neutral chip palette |

### Display format (D13/D14)
  • **Badge label:** `D MMMM` Jalali ("15 فروردین") when the due Jalali
    year matches today's Jalali year. `D MMMM YYYY` otherwise
    ("15 فروردین 1405").
  • **Tooltip (D14):** `YYYY/MM/DD` Jalali (canonical full form).
  • **Today variant:** label is just "امروز" — the date is implicit.
  • **Overdue variant:** label is `منقضی · D MMMM` so the user sees
    *which* missed date.

### Jalali input parsing (picker)
The picker uses a plain `<input type="text" dir="auto" />` with
Persian placeholder `۱۴۰۴/۰۱/۱۵`. **Do not** use
`<input type="date" />` (forces Gregorian) or
`<input type="datetime-local" />` (forces Gregorian + time).

Parse:
```ts
const result = fromJalaliInput(input.trim());
if (!result.ok) {
  setError("تاریخ معتبر نیست. مثال: ۱۴۰۴/۰۱/۱۵");
  return;
}
mutate({ ..., dueDate: result.value });
```

`fromJalaliInput` returns `ParseResult<DateOnly>` and **never throws**
— always branch on `result.ok`. The Persian error message is
toast-ready.

### Keyboard shortcuts in the picker
  • `Enter` — save.
  • `Escape` — cancel.
  • Empty input + save = clear (matches the dedicated clear button).

### "Now" source for overdue / today comparison
`isOverdue` defaults to `new Date().toISOString()` (browser clock).
The badge uses `nowUIOnly()` (the documented exception in
`date-engine.md`: "for display only — never persist it"). Server-time
strict accuracy would require a `system.now` tRPC endpoint and a
periodic sync; deferred until a featurelet actually demands it. The UX
cost of being a few seconds off the server clock is negligible for a
calendar-day comparison.

## Don't

  • **Don't** read `payload.dueDate` on a card-due-date event — v2
    renamed it to `newDueDate`.
  • **Don't** write the due date into `cards.accounting_data` JSONB.
    The first-class column is `cards.due_date`.
  • **Don't** use `<input type="date">` or `<input type="datetime-local">`
    in the picker — they force Gregorian. The text input + `fromJalaliInput`
    is the only correct path.
  • **Don't** call `boardApi.updateCardDueDate` — it's an explicit-throw
    shim. Use `boardApi.setCardDueDate`.
  • **Don't** trust client-supplied `tenantId` or `updatedBy` on the
    server side; the router populates these from `ctx.session`.
  • **Don't** `new Date()` against a `DateOnly` — use `isOverdue` from
    `lib/date.ts`.
  • **Don't** forget `boardId` in the mutation payload — the
    `boardProtectedProcedure` middleware reads it from rawInput before
    Zod parsing.

## Adding a similar card-feature column (template)

The template captured here for the next featurelet (Phase 1.2.5+):

  1. Migration `NNNN_phaseXY_<column>.sql` — `ALTER TABLE cards ADD
     COLUMN IF NOT EXISTS …` + partial index if the column is queried.
  2. Drizzle schema `cards.ts` — add the column, mirror the index.
  3. Domain `Card` interface — add the field.
  4. Domain event v2 with old/new pair + actor.
  5. Pure use case returning the discriminated union.
  6. Router with boardProtectedProcedure + topology guard +
     atomic outbox + idempotency (mirror `due-date.router.ts`).
  7. CardDto field + reducer for the new event type.
  8. Mutation hook with optimistic envelope.
  9. Badge in `apps/web/src/components/cards/` (shared) when CardItem
     consumes it.
  10. Detail-tab component in `features/board/components/card-detail/`.
  11. Steering doc mirroring this one.

## F1.2.2 follow-ups (parked)

  • **Filter by due date** in the board view (Phase 1.2 polish).
  • **Watch / due-date-approaching notifications** (Phase 1.2.5+).
  • **Activity timeline integration** (Phase 1.2.6) — the v2 event
    payload already carries `oldDueDate` and `updatedBy` so the
    projection has all it needs.
  • **`accounting_data` JSONB cleanup** of stale `dueDate` keys
    written by the pre-F1.2.2 stub (Phase 1.5 janitor).
  • **Server-time strict comparison** — currently uses browser clock
    via `nowUIOnly()`. A `system.now` tRPC endpoint + periodic sync
    would make the badge palette server-time-correct, at the cost of
    a tRPC round-trip.
  • **Time-of-day component** — F1.2.2 ships date-only. If the team
    later wants "due at 17:00", the storage shape would need to flip
    to TIMESTAMPTZ with a separate decision around timezone display.
