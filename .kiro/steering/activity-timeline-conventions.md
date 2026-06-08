---
inclusion: always
---

# Activity Timeline — Phase 1.2 (F1.2.6) Conventions

---

## Decision Points (D1..D12)

| # | Decision | Resolution |
|---|---|---|
| D1 | Source of truth | `outbox_events` (NOT `audit_logs`) — all mutations emit to outbox |
| D2 | Actor enrichment | SQL LEFT JOIN users ON u.id = COALESCE(actorId, authorId, createdBy, assignedBy) |
| D3 | Label enrichment | SQL LEFT JOIN labels ON l.id = payload->>'labelId'; fallback «حذف‌شده» |
| D4 | Checklist name | Read directly from event payload.title (no JOIN needed) |
| D5 | List enrichment | SQL LEFT JOIN lists fl ON fl.id = payload->>'fromListId'; same for toListId |
| D6 | Pagination | Cursor-based via `occurred_at` (ISO timestamp). 20 events per page |
| D7 | Real-time | Merge server query + `store.activityFeed` filtered by cardId; dedup by id |
| D8 | Filter | V1: all events. Filter by type parked for V2 |
| D9 | Persian text | Each event type has a pure formatter in `lib/activity/formatActivityText.ts` |
| D10 | ActivityEntry DTO | Same as store; extended with `actorName?`, `actorAvatar?` optional fields |
| D11 | applyActivity.ts | Existing implementation handles all event types; no changes needed |
| D12 | Schema migration | None required — reads from existing `outbox_events` table |

---

## Source: outbox_events

```sql
SELECT
  o.event_id AS id,
  o.type AS event_type,
  o.occurred_at AS timestamp,
  o.payload,
  u.display_name AS actor_name,
  u.avatar_url AS actor_avatar,
  l.name AS label_name,
  fl.title AS from_list_title,
  tl.title AS to_list_title
FROM outbox_events o
LEFT JOIN users u ON u.id = COALESCE(
  o.payload->>'actorId',
  o.payload->>'authorId',
  o.payload->>'createdBy',
  o.payload->>'assignedBy'
)
LEFT JOIN labels l ON l.id = (o.payload->>'labelId')
LEFT JOIN lists fl ON fl.id = (o.payload->>'fromListId')
LEFT JOIN lists tl ON tl.id = (o.payload->>'toListId')
WHERE o.payload->>'cardId' = $cardId
  AND (o.type LIKE 'card.%' OR o.type LIKE 'comment.%' OR ...)
ORDER BY o.occurred_at DESC
LIMIT limit + 1
```

---

## Enrichment in payload

The router forwards enrichment fields into the payload object so the
formatter can read them without knowing about the JOIN layer:
- `payload.labelName` — from `labels.name`
- `payload.fromListTitle` — from lists JOIN
- `payload.toListTitle` — from lists JOIN

---

## Persian Formatter (`lib/activity/formatActivityText.ts`)

| Event Type | Persian Text |
|---|---|
| `card.created` | «{actor} این کارت را ساخت» |
| `card.updated` (title) | «{actor} عنوان را به «{title}» تغییر داد» |
| `card.updated` (desc) | «{actor} توضیحات را ویرایش کرد» |
| `card.moved` | «{actor} کارت را از «{from}» به «{to}» منتقل کرد» |
| `card.deleted` | «{actor} این کارت را حذف کرد» |
| `card.locked` | «{actor} کارت را قفل کرد» |
| `card.unlocked` | «{actor} قفل کارت را باز کرد» |
| `card.due_date_updated` | Jalali date display |
| `card.label_added` | «{actor} برچسب «{name}» را اضافه کرد» |
| `card.label_removed` | «{actor} برچسب «{name}» را حذف کرد» |
| `card.assignee_added` | «{actor} یک مسئول به کارت اضافه کرد» |
| `card.assignee_removed` | «{actor} یک مسئول را از کارت حذف کرد» |
| `comment.created` | «{actor} یک نظر ثبت کرد» |
| `comment.updated` | «{actor} نظر خود را ویرایش کرد» |
| `comment.deleted` | «{actor} یک نظر را حذف کرد» |
| `checklist.created` | «{actor} چک‌لیست «{title}» را اضافه کرد» |
| `checklist.item_updated` (isDone=true) | «{actor} «{text}» را کامل کرد» |
| default | «{actor} یک تغییر ایجاد کرد» |

---

## Real-time merge strategy (D7)

1. `tRPC getByCard` query hydrates `allEntries` (server-authoritative, enriched)
2. `useBoardStore.activityFeed.filter(e => e.payload.cardId === cardId)` provides
   live events pushed via WebSocket (may lack actor enrichment — resolved from
   `boardMembers` cache in ActivityRow)
3. Merge: dedup by `entry.id`, sort DESC by `timestamp`

---

## Component placement

| File | Location | Layer |
|---|---|---|
| `formatActivityText.ts` | `lib/activity/` | shared lib |
| `activityEventIcon.ts` | `lib/activity/` | shared lib |
| `ActivitySkeleton.tsx` | `features/board/card-detail/activity/` | feature |
| `ActivityRow.tsx` | `features/board/card-detail/activity/` | feature |
| `CardActivity.tsx` | `features/board/card-detail/` | feature |

---

## Don't

- **Don't** use `new Date().toLocaleString()` — always `formatRelative` or `toJalaliDisplay`
- **Don't** show raw UUIDs — always resolve displayName
- **Don't** query `audit_logs` — source is `outbox_events`
- **Don't** import dayjs directly — always through `@/lib/date`
- **Don't** read `actor_id` from top-level outbox column — use `payload.actorId` via COALESCE

---

## Parked follow-ups

- Filter by event type (V2 activity) → future
- Activity per board (F1.5)
- Email notification on activity (F1.2.9)
- Export activity log
- Reactions/comments on activity items
