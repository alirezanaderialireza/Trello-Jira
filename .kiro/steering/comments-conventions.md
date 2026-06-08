---
inclusion: always
---

# Comments — Phase 1.2 (F1.2.4.a + F1.2.4.b) Conventions

Persistence, domain, API, event-payload, and UI rules for the comments
feature. Mirrors `checklists-conventions.md` — single-table aggregate
(no child items table).

---

## Decision Points (D1..D9 — F1.2.4.a API/DB)

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

**RLS** — ENABLE + FORCE. Four split-command policies with
`tenant_id = current_tenant_id()` + `board_members EXISTS` predicate.

**NOTE on `author_id` column type:** stays `varchar(128)` (not `uuid FK`).
A future cleanup migration can perform the cast.

---

## Domain (`packages/domain/src/comments`)

### Entity

```ts
interface CommentEntity {
  id, tenantId, cardId, boardId, authorId,
  body: string,      // trimmed, max 5 000 chars
  revision: number,
  createdAt, updatedAt, editedAt: Date | null,
  deletedAt: Date | null, deletedBy: UserId | null
}
```

### Use cases (3 pure functions)

- `createComment` — validate body, build entity + event.
- `updateComment` — validate body, no-op detection, discriminated union.
- `deleteComment` — build soft-delete patch + event.

### Errors (5 classes)

| Class | TRPCError code | Persian message |
|---|---|---|
| `CommentBodyRequiredError` | BAD_REQUEST | متن کامنت الزامی است. |
| `CommentBodyTooLongError` | BAD_REQUEST | متن کامنت نباید از ۵٬۰۰۰ نویسه بیشتر باشد. |
| `CommentNotFoundError` | NOT_FOUND | کامنت یافت نشد. |
| `CommentCardMismatchError` | BAD_REQUEST | کامنت به این کارت تعلق ندارد. |
| `CommentAuthorOnlyError` | FORBIDDEN | فقط نویسنده می‌تواند این کامنت را ویرایش کند. |

---

## Events (schema version 2)

| Type | Aggregate | Payload v2 fields |
|---|---|---|
| `comment.created` | card | commentId, cardId, boardId, authorId, body, createdAt, **revision** |
| `comment.updated` | card | commentId, cardId, boardId, body, editedAt |
| `comment.deleted` | card | commentId, cardId, boardId, **deletedBy** |

---

## API (`packages/api/src/routers/card-features/comments.router.ts`)

Mounted at `v1.public.comment.*`.

```
list({ boardId, cardId, cursor?, limit?=50 })           → { comments, nextCursor? }
create({ boardId, cardId, body, idempotencyKey })        → CommentDto
update({ boardId, commentId, body, idempotencyKey })     → { success, noOp }
delete({ boardId, commentId, idempotencyKey })           → { success }
```

### Authorisation (D5)

| Action | Procedure | Extra check |
|---|---|---|
| list | `boardProtectedProcedure` | — |
| create | `boardProtectedProcedure` | — |
| update | `boardProtectedProcedure` | inline: author only |
| delete | `boardProtectedProcedure` | inline: author OR admin/owner |

---

## DB Repository

`DrizzleCommentsRepository` in `packages/db/src/repositories/comments.repository.ts`:
`findById`, `findByIdWithAuthor`, `findByCardId`, `findByCardIdWithAuthors`,
`create`, `update`, `softDelete`.
Exported as `commentsRepo` singleton in `packages/db/src/index.ts`.

---

## Web client

### CommentDto (Zustand store)

```ts
{ id, cardId, boardId, authorId, body,
  createdAt: string, editedAt?: string, revision: number, isOptimistic?: boolean }
```

### Mutation hooks

| Hook | Variables |
|---|---|
| `useAddComment` | `{ cardId, boardId, authorId, body, correlationId }` |
| `useUpdateComment` | `{ commentId, cardId, boardId, body, correlationId }` |
| `useDeleteComment` | `{ commentId, cardId, boardId, actorId, correlationId }` |

### boardApi facade

```ts
createComment({ cardId, boardId, body, idempotencyKey, correlationId? })
updateComment({ commentId, boardId, body, idempotencyKey, correlationId? })
deleteComment({ commentId, boardId, idempotencyKey, correlationId? })
listComments({ boardId, cardId, cursor?, limit? })
```

---

## Don't

- **Don't** call `boardApi.addComment` — deprecated shim that throws.
- **Don't** call `trpc.v1.public.comment.getByCard` — renamed to `list`.
- **Don't** pass `mutationId` — v2 uses `idempotencyKey`.
- **Don't** hard-delete a comment — soft-delete only.
- **Don't** trust client-supplied `authorId` / `tenantId`.
- **Don't** set `editedAt` on `comment.created` — always null at creation.

---

## F1.2.4.b checklist (UI — ✅ shipped)

All items shipped in F1.2.4.b.

- ✅ **lib/relativeTime.ts** — `formatRelative` + `formatAbsolute` with
  Persian numerals. Vitest suite.
- ✅ **components/users/UserAvatar.tsx** — deterministic hash-colour
  fallback, three sizes (xs/sm/md), `getFirstGrapheme` for initials.
  Shared territory.
- ✅ **store/hooks/useHydrateComments.ts** — `useInfiniteQuery` cursor
  pagination, hydrates Zustand store via synthetic `comment.created`
  envelopes.
- ✅ **CommentEditForm** — inline textarea, auto-resize, 5000-char
  counter, Cmd/Ctrl+Enter save, Esc cancel, no-op detection.
- ✅ **CommentItem** — UserAvatar, relative timestamp + absolute tooltip,
  «(ویرایش‌شده)» badge, deleted placeholder, hover-reveal actions
  (always visible on mobile), isOptimistic dimming.
- ✅ **CommentForm** — new-comment textarea, collapsed by default,
  focus-expand, Cmd/Ctrl+Enter, focus-retention after submit.
- ✅ **DeleteCommentDialog** — body preview (100 chars), no type-to-confirm
  (D-UI-1), Esc/backdrop/X, focus on confirm button.
- ✅ **CommentsList** — oldest-first display, «نمایش کامنت‌های قدیمی‌تر»
  CTA at top, skeleton loading, error state, empty state.
- ✅ **CardComments** (full rewrite) — session-aware container, passes
  userId + role; replaces placeholder stub.
- ✅ **CardCommentsBadge** — shared badge, MessageSquare + Persian count,
  hidden when 0. `components/cards/`.
- ✅ **CardItem** — atomic selector + `CardCommentsBadge` below dueDate.
- ✅ **CardDetailModal** — Persian tab labels, comment count on «گفت‌وگو»
  tab, RTL tab bar.

---

# F1.2.4.b UI Conventions

## Component placement

| File | Location | Layer |
|---|---|---|
| `CardComments.tsx` | `features/board/components/card-detail/` | feature (board) |
| `CommentsList.tsx` | `features/board/components/card-detail/comments/` | feature (board) |
| `CommentItem.tsx` | same | feature (board) |
| `CommentEditForm.tsx` | same | feature (board) |
| `CommentForm.tsx` | same | feature (board) |
| `DeleteCommentDialog.tsx` | same | feature (board) |
| `useHydrateComments.ts` | `features/board/store/hooks/` | feature (board) |
| `UserAvatar.tsx` | `components/users/` | **shared** |
| `CardCommentsBadge.tsx` | `components/cards/` | **shared** |
| `lib/relativeTime.ts` | `lib/` | **shared** |

`UserAvatar` and `CardCommentsBadge` are in shared territory because
`CardItem` (features/board) needs `CardCommentsBadge` and the boundaries
linter blocks cross-feature imports.

## Display order: oldest-first (D-UI-2)

The server returns comments **newest-first** (desc `createdAt`, D9).
The UI displays **oldest-first** (chronological conversation order —
matches Trello). `CommentsList` sorts hydrated store entries by
`createdAt` ascending. «نمایش کامنت‌های قدیمی‌تر» CTA sits at the **top**
because older comments are above newer ones in the display.

## type-to-confirm: not used (D-UI-1)

`DeleteCommentDialog` shows a 100-char body preview + two buttons.
No type-to-confirm because comment bodies are free-form and not stable
identifiers. Matches Linear's delete-comment UX.

## Author display name (current limitation)

`v1.public.comment.list` returns `authorId` (UUID) but not `displayName`
or `avatarUrl`. `CommentItem` falls back to `«کاربر <first-8-chars>»`.
A future `listWithAuthors` procedure will resolve display names.

## relativeTime thresholds

| Elapsed | Display |
|---|---|
| < 60 s | «الان» |
| < 60 min | «N دقیقه پیش» |
| < 24 h | «N ساعت پیش» |
| < 48 h | «دیروز» |
| < 7 days | «N روز پیش» |
| ≥ 7 days | Jalali absolute (D MMMM YYYY، HH:mm) |

## Cmd/Ctrl+Enter convention

Both `CommentEditForm` and `CommentForm` send on `metaKey || ctrlKey` +
`Enter`. Matches GitHub / Linear / Notion convention.

## Real-time

All three comment event types (`comment.created`, `comment.updated`,
`comment.deleted`) are wired in the dispatcher from F1.2.4.a.
The WS event loop reconciles store state in real-time — no extra wiring
needed in F1.2.4.b.

---

## Parked follow-ups

- **@mentions** and push notifications → فاز ۱.۲.۵+.
- **Reactions** (👍 ❤️ ✓) → polish.
- **Markdown / rich-text** → فاز ۱.۳.
- **Inline attachments** → separate featurelet.
- **Edit history viewer** → فاز ۱.۲.۸ Activity Timeline.
- **Typing indicator** → Presence فاز ۱.۳.
- **Read receipts, Pinned, Quote-reply** → MVP-out.
- **E2E spec** → فاز ۱.۴.
- **Author `author_id` cast to `uuid FK`** → future cleanup migration.
- **listWithAuthors tRPC procedure** → unlocks real display names + avatars.
