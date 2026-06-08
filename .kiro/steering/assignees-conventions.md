---
inclusion: always
---

# Assignees (Members on Cards) — Phase 1.2 (F1.2.5) Conventions

---

## Decision Points (D1..D12)

| # | Question | Resolution |
|---|---|---|
| D1 | Storage | Junction table `card_assignees` with composite PK (card_id, user_id), denormalised `tenant_id`, `assigned_by`, `assigned_at` |
| D2 | Card domain entity | No change — assignees NOT added to Card entity. CardDto.assignees: string[] in client store only |
| D3 | Self-assign | Allowed. Current user pinned to top of picker with «(شما)» badge |
| D4 | Max assignees | 50 per card (server sanity check) |
| D5 | Permissions | Any active board member can add/remove any other member (including self) |
| D6 | Event payload v2 | added: +assignedBy; removed: +removedBy (for Activity Timeline F1.2.8) |
| D7 | UI order | assignedAt ascending (oldest to right in RTL) |
| D8 | Self-assign UX | Single unified picker, no separate toggle. Current user pinned at top |
| D9 | Card lock interaction | Locked card: only ADMIN/OWNER can change assignees |
| D10 | Notification | Parked → F1.2.9 |
| D11 | Filter by assignee | Parked → F1.5 (listMyCards procedure is ready) |
| D12 | Groups/teams | Out of MVP scope |

---

## Schema (migration `0011_phase1.2_card_assignees.sql`)

```
card_assignees
  card_id     uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE
  user_id     varchar(128) NOT NULL REFERENCES users(id) ON DELETE CASCADE
  tenant_id   uuid NOT NULL         ← denormalised for RLS without JOIN
  assigned_by varchar(128) NOT NULL REFERENCES users(id)
  assigned_at timestamptz NOT NULL DEFAULT now()
  PRIMARY KEY (card_id, user_id)
```

**Indexes:**
- `idx_card_assignees_user (tenant_id, user_id)` — "My Cards" F1.5 reverse lookup
- `idx_card_assignees_tenant (tenant_id)` — RLS planner hint

**RLS:** tenant-only check (no board_members EXISTS). Rationale: same as card_labels and checklist_items — reachable only through cards which already enforces membership.

---

## Domain (`packages/domain/src/assignees/`)

### Entity

```ts
CardAssigneeEntity { cardId, userId, tenantId, assignedBy, assignedAt }
```

### Use cases (2 pure functions)

- `addAssigneeToCard` — validates isBoardMember, isAlreadyAssigned, max-50, lock-role. Returns entity + event.
- `removeAssigneeFromCard` — validates isAssigned, lock-role. Returns event.

### Errors (5 classes)

| Class | TRPCError code | Persian message |
|---|---|---|
| `AssigneeNotBoardMemberError` | BAD_REQUEST | کاربر عضو این برد نیست. |
| `AlreadyAssignedError` | CONFLICT | این کاربر قبلاً به کارت اضافه شده. |
| `NotAssignedError` | NOT_FOUND | این کاربر به این کارت اختصاص نیافته. |
| `MaxAssigneesError` | BAD_REQUEST | تعداد مسئولین از حد مجاز بیشتر است. |
| `CardLockedAssigneeError` | FORBIDDEN | کارت قفل است؛ فقط مدیر می‌تواند تغییر دهد. |

---

## Events (schemaVersion 2)

| Type | Payload v2 |
|---|---|
| `card.assignee_added` | cardId, boardId, assigneeId, **assignedBy** |
| `card.assignee_removed` | cardId, boardId, assigneeId, **removedBy** |

No v1 backward-compat — stub never emitted outbox events.

---

## API (`v1.public.cardAssignee.*`)

```
list({ boardId, cardId })                                   → AssigneeDto[]
addAssignee({ boardId, cardId, assigneeId, idempotencyKey }) → { success, assignee }
removeAssignee({ boardId, cardId, assigneeId, idempotencyKey }) → { success }
listMyCards({ boardId })                                    → { cardIds: string[] }
```

All on `boardProtectedProcedure`. Topology guard + isBoardMember + lock-role check on mutations.

---

## Web UI Conventions (D21)

### Component placement

| File | Location | Layer |
|---|---|---|
| `UserAvatar.tsx` | `components/users/` | **shared** |
| `AssigneeAvatarStack.tsx` | `components/users/` | **shared** |
| `CardAssigneesBadge.tsx` | `components/cards/` | **shared** |
| `AssigneePicker.tsx` | `features/assignees/components/` | feature |
| `CardAssignees.tsx` | `features/board/components/card-detail/` | feature |

`UserAvatar`, `AssigneeAvatarStack`, `CardAssigneesBadge` are in **shared** territory because `CardItem` (features/board) needs them and the boundaries linter blocks cross-feature imports.

### boardMembers store slice

`state.boardMembers: Record<userId, BoardMemberDto>` — populated by `hydrateBoardMembers(members)` action. Source: `v1.public.boardMembers.getMembers`. Used by `AssigneePicker` and `AssigneeAvatarStack` to resolve display names + avatars without per-card round-trips.

### Avatar stack RTL ordering (D7)

assignedAt ascending → oldest assignee to the right in RTL. Stack overlaps with negative margin-start. Tooltip lists all names.

### Keyboard shortcut «A»

`CardAssignees` registers a window-level `keydown` listener for `A`. Guards: skip when focus is inside input/textarea/select/contenteditable; skip when Ctrl/Meta/Alt held.

### Runtime crash fix (Phase-4 stub)

The Phase-4 boardApi pointed to `cardApi.addAssignee` / `cardApi.removeAssignee` — routes that never existed, causing runtime crashes on first click. F1.2.5 fixes this by routing to `v1.public.cardAssignee.addAssignee` / `removeAssignee` with `boardId + idempotencyKey`.

---

## Don't

- **Don't** trust client-supplied `assigneeId` without `isBoardMember` check.
- **Don't** bypass lock-role check on mutations.
- **Don't** set `assignedBy` from client input — always from `ctx.session.user.id`.
- **Don't** insert into `card_assignees` directly — bypasses outbox and idempotency.

---

## Parked follow-ups

- **Notification when assigned** → F1.2.9.
- **Filter board by assignee** → F1.5 (listMyCards procedure ready).
- **Bulk-assign** → polish.
- **Assignee groups/teams** → out of MVP scope.
- **Activity timeline** → F1.2.8 (payload v2 ready: assignedBy/removedBy).
- **E2E spec** → F1.4.
