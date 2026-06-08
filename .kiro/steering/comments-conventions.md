---
inclusion: always
---

# Comments — Phase 1.2 (F1.2.4.a) Conventions

Persistence, domain, API, and event-payload rules for the comments
feature. Mirrors `checklists-conventions.md` — single-table aggregate
(no child items table).

---

## Decision Points (D1..D9)

| # | Question | Resolution | Rationale |
|---|---|---|---|
| D1 | Drift recovery: ALTER or DROP/CREATE? | **ALTER** | Router `create` was reachable from traffic; data preservation is the safe default. Only `revision`, `updated_at`, `deleted_by` added. |
| D2 | Extra columns | `revision integer NOT NULL DEFAULT 0`, `updated_at timestamptz NOT NULL DEFAULT now()`, `deleted_by uuid` (nullable FK → users) | OCC + audit + soft-delete attribution. No `body_length` (YAGNI). |
| D3 | Max body length | **5 000 chars** | Aligned with Trello / Linear. Was 10 000 in the stub — reduced. |
| D4 | Soft-delete shape | **(ب)** `deletedAt` set, `body` preserved, event carries `deletedBy` | UI (F1.2.4.b) decides the "deleted" display copy. |
| D5 | Permission matrix | create → any board member; update → author only; delete → author OR admin/owner | Mirrors `deleteChecklist` (F1.2.3.a). |
| D6 | Edit history table | **No** — `editedAt` only. `comment_edits` is Parked. | YAGNI. |
| D7 | v2 payload additions | `CommentCreatedPayload` + `revision: number`; `CommentDeletedPayload` + `deletedBy: string` | Consistent with checklist events; `deletedBy` needed by F1.2.8. |
| D8 | Rich features | **All Parked** — plain text only, no markdown / mentions / reactions | Outside scope. |
| D9 | Pagination | Cursor-based (cursor = last seen commentId), `limit` default 50, sort **newest-first** (desc `createdAt`) | Same shape as the stub's `getByCard`. |

---

## Schema (migration `0010_phase1.2_comments.sql`)

Single table `comments`, hardened from the Phase-4 rich-card stub via
**ALTER** (D1):

```
comments
  id           uuid PK DEFAULT gen_random_uuid()
  tenant_id    uuid NOT NULL
  card_id      uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE
  board_id     uuid NOT NULL
  author_id    varchar(128) NOT NULL   ← contains valid UUIDs; cast deferred
  body         text NOT NULL           ← max 5 000 chars enforced in domain/router
  revision     integer NOT NULL DEFAULT 0            ← added F1.2.4.a (D2)
  created_at   timestamptz NOT NULL DEFAULT now()
  edited_at    timestamptz
  updated_at   timestamptz NOT NULL DEFAULT now()    ← added F1.2.4.a (D2)
  deleted_at   timestamptz
  deleted_by   uuid REFERENCES users(id)             ← added F1.2.4.a (D2)
```

**Indexes**

| Name | Columns | Condition |
|---|---|---|
| `idx_comments_card` | `(card_id, created_at)` | `WHERE deleted_at IS NULL` |
| `idx_comments_board` | `(tenant_id, board_id)` | `WHERE deleted_at IS NULL` |
| `idx_comments_tenant` | `(tenant_id)` | — (planner hint for RLS) |

**RLS** — ENABLE + FORCE. Four split-command policies:

```sql
-- SELECT/INSERT/UPDATE/DELETE
USING (
  tenant_id = current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM board_members bm
    WHERE bm.board_id  = comments.board_id
      AND bm.user_id   = app.current_user_id()
      AND bm.tenant_id = current_tenant_id()
      AND bm.removed_at IS NULL
  )
)
```

Same three-layer defence as `checklists`:
1. `boardProtectedProcedure` (application)
2. RLS board membership EXISTS (database)
3. RLS tenant filter (database)

**NOTE on `author_id` column type:** stays `varchar(128)` (not `uuid FK`).
The original stub used varchar; casting to uuid is safe but requires a
`USING` clause and was out of scope for this migration. The column always
contains valid UUID strings in practice. A future cleanup migration can
perform the cast.

---

## Domain (`packages/domain/src/comments`)

### Entity

```ts
interface CommentEntity {
  id:        CommentId;   // branded string
  tenantId:  TenantId;
  cardId:    CardId;
  boardId:   BoardId;
  authorId:  UserId;
  body:      string;      // trimmed, max 5 000 chars
  revision:  number;      // incremented on every mutation
  createdAt: Date;
  updatedAt: Date;
  editedAt:  Date | null;
  deletedAt: Date | null;
  deletedBy: UserId | null;
}
```

`CommentId` is branded; events carry plain `string`s.

### Use cases (3 pure functions)

- `createComment(input)`  — validate body, build entity + event.
- `updateComment(input)`  — validate body, no-op detection (same body
  after trim → `{ noOp: true }`). Returns discriminated union.
- `deleteComment(input)`  — build soft-delete patch + event.
  Authorisation is enforced by the router before this is called.

All use cases are **pure**: no DB, no clock, no random IDs. Side effects
live in the router.

### Errors (5 classes)

| Class | TRPCError code | Persian message |
|---|---|---|
| `CommentBodyRequiredError` | BAD_REQUEST | متن کامنت الزامی است. |
| `CommentBodyTooLongError` | BAD_REQUEST | متن کامنت نباید از ۵٬۰۰۰ نویسه بیشتر باشد. |
| `CommentNotFoundError` | NOT_FOUND | کامنت یافت نشد. |
| `CommentCardMismatchError` | BAD_REQUEST | کامنت به این کارت تعلق ندارد. |
| `CommentAuthorOnlyError` | FORBIDDEN | فقط نویسنده می‌تواند این کامنت را ویرایش کند. |

`CardNotFoundError` is re-used from `@repo/domain` (same class as in
labels/checklists — no duplicate export needed).

---

## Events (schema version 2)

Three event types, all carrying `schemaVersion: 2`. No v1 backward-
compat needed — the stub router never emitted outbox events.

| Type | Aggregate | Payload v2 fields |
|---|---|---|
| `comment.created` | card | commentId, cardId, boardId, authorId, body, createdAt, **revision** |
| `comment.updated` | card | commentId, cardId, boardId, body, editedAt |
| `comment.deleted` | card | commentId, cardId, boardId, **deletedBy** |

`DomainEventType` union in `events/base.ts` already included all three
types — no change needed.

---

## API (`packages/api/src/routers/card-features/comments.router.ts`)

Mounted at `v1.public.comment.*` (unchanged from stub).

```
v1.public.comment.list({
  boardId, cardId, cursor?, limit?
}) → { comments: CommentDto[], nextCursor? }

v1.public.comment.create({
  boardId, cardId, body, idempotencyKey, correlationId?
}) → CommentDto

v1.public.comment.update({
  boardId, commentId, body, idempotencyKey, correlationId?
}) → { success, noOp }

v1.public.comment.delete({
  boardId, commentId, idempotencyKey, correlationId?
}) → { success }
```

### Authorisation (D5)

| Action | Procedure | Extra check |
|---|---|---|
| list | `boardProtectedProcedure` | — |
| create | `boardProtectedProcedure` | — |
| update | `boardProtectedProcedure` | inline: `authorId === ctx.session.user.id` |
| delete | `boardProtectedProcedure` | inline: author OR `role === "ADMIN" \|\| "OWNER"` |

### Atomic outbox + idempotency skeleton

```
mutation: boardProtectedProcedure.input(…).mutation(({ input, ctx }) =>
  withIdempotency(ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey, async () => {
    const repo = new DrizzleCommentsRepository(ctx.infra.db);
    // 1. findById (for update/delete — includes topology guard)
    // 2. run the pure use case
    // 3. await repo.create / update / softDelete (ctx.infra.db)
    // 4. await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(event))
    // 5. return response (cached by withIdempotency)
  })
)
```

`schemaVersion` label: `"comments.v2"`.

### Topology guards (R9 defence-in-depth)

- `create`: `cardRow.boardId === input.boardId` (after loading the card).
- `update` / `delete`: `comment.boardId === input.boardId` (after loading
  the comment via `findById`). If divergence → `CommentCardMismatchError`.

---

## DB Repository (`packages/db/src/repositories/comments.repository.ts`)

`DrizzleCommentsRepository` implements `CommentsRepository<DbTx>`:

| Method | Notes |
|---|---|
| `findById(id, options?)` | tenant-scoped, notDeleted filter |
| `findByIdWithAuthor(id, options?)` | LEFT JOIN users → displayName + avatarUrl |
| `findByCardId(cardId, { limit, cursor? })` | cursor pagination, desc createdAt, +1 hasMore trick |
| `findByCardIdWithAuthors(cardId, { limit, cursor? })` | same + LEFT JOIN users |
| `create(tx, entity)` | |
| `update(tx, id, patch)` | body + editedAt + updatedAt + revision |
| `softDelete(tx, id, patch)` | deletedAt + deletedBy + updatedAt + revision |

Exported as `commentsRepo` singleton + `DrizzleCommentsRepository` class
in `packages/db/src/index.ts`.

---

## Web (`apps/web/`)

### CommentDto (Zustand store — `useBoardStore.ts`)

```ts
CommentDto: {
  id, cardId, boardId, authorId, body,
  createdAt: string,   // ISO-8601
  editedAt?: string,
  revision: number,    // F1.2.4.a addition (was already in DTO)
  isOptimistic?: boolean
}
```

No breaking change to the existing DTO shape.

### Reducer (`event-application/applyComment.ts`)

Adapted for v2 payloads (backward-compat `?? fallback` for optimistic envelopes):
- `applyCommentCreated`: reads `payload.revision ?? envelope.event.version`.
- `applyCommentDeleted`: `payload.deletedBy` present but ignored at store
  level (reserved for F1.2.8 activity timeline).

### Mutation hooks (3 hooks under `mutations/comments/`)

| Hook | Variables |
|---|---|
| `useAddComment` | `{ cardId, boardId, authorId, body, correlationId }` |
| `useUpdateComment` | `{ commentId, cardId, boardId, body, correlationId }` |
| `useDeleteComment` | `{ commentId, cardId, boardId, actorId, correlationId }` |

All three now use `idempotencyKey` (= correlationId) on the server call.
Optimistic envelopes mirror the v2 payload shape.

### boardApi facade (`api/services/boardApi.ts`)

```ts
createComment({ cardId, boardId, body, idempotencyKey, correlationId? })
updateComment({ commentId, boardId, body, idempotencyKey, correlationId? })
deleteComment({ commentId, boardId, idempotencyKey, correlationId? })
listComments({ boardId, cardId, cursor?, limit? })  // for F1.2.4.b hydration
```

`addComment` is a deprecated shim that throws a clear error message.

### CardComments.tsx

Replaced with a safe placeholder stub + `TODO F1.2.4.b` comment block.
The previous stub called `trpc.v1.public.comment.getByCard` (removed in
F1.2.4.a) and passed no `boardId` or `idempotencyKey`, so it would crash
at runtime. The placeholder renders a Persian "loading in F1.2.4.b" note
until the full UI is implemented.

---

## Don't

- **Don't** read `payload.name` or `payload.title` on a comment event —
  comments use `body`.
- **Don't** call `trpc.v1.public.comment.getByCard` — renamed to `list`.
- **Don't** call `boardApi.addComment` — replaced by `createComment`
  (the shim throws in development).
- **Don't** pass `mutationId` to comment procedures — v2 uses
  `idempotencyKey`.
- **Don't** insert into `comments` directly (bypassing the router) —
  the `tenantId` / `authorId` provenance and the outbox emit are owned
  by the router.
- **Don't** hard-delete a comment. Soft-delete (`deleted_at = now()`)
  preserves the activity timeline (F1.2.8). Body is kept for audit;
  UI decides the display copy in F1.2.4.b.
- **Don't** trust client-supplied `authorId` or `tenantId` — the router
  always populates these from `ctx.session`.
- **Don't** set `editedAt` on `comment.created` — it is always `null` at
  creation time and only the `comment.updated` event carries `editedAt`.

---

## F1.2.4.b checklist (UI — follow-up)

- [ ] **CardComments** full rewrite — replace placeholder stub; fetch via
  `boardApi.listComments`, hydrate Zustand store, reads from store.
- [ ] Cursor-based pagination with «بارگذاری کامنت‌های بیشتر» CTA.
- [ ] Author display name + avatar (use `findByCardIdWithAuthors` via a
  dedicated tRPC list-with-authors procedure or extend `list`).
- [ ] Inline edit for author's own comments (`useUpdateComment`).
- [ ] Delete button gated on author OR admin (`useDeleteComment`).
- [ ] Persian timestamps (Jalali via `@/lib/date`).
- [ ] Optimistic "in-flight" state on new comment row.
- [ ] RTL layout, accessible form, `aria-label` on all interactive elements.

---

## Parked follow-ups

- **@mentions** and push notifications → فاز ۱.۲.۵+.
- **Reactions** (👍 ❤️ ✓) → فاز ۱.۲ polish.
- **Markdown / rich-text** → فاز ۱.۳.
- **Inline attachments** in comment body → separate featurelet.
- **Edit history table** (`comment_edits`) → فاز ۱.۲.۸ Activity Timeline.
- **Real-time typing indicator** → Presence phase ۱.۳.
- **Read receipts** → outside MVP scope.
- **E2E spec** → فاز ۱.۴.
- **`author_id` column cast to `uuid FK`** → future cleanup migration.
