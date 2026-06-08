---
inclusion: manual
---

# Notifications & Watch Conventions (F1.2.9)

How the watch + notification (Inbox) system is wired across the stack.

## Data model

- **`card_watchers`** — composite PK `(card_id, user_id)`, denormalised
  `tenant_id`. Tenant-only RLS (reachable only through cards, which already
  enforce board membership). `card_id` has a real FK to `cards`; `user_id` is
  `varchar(128)` with **no** cross-type FK to `users(id uuid)` (same choice as
  `attachments.uploaded_by`).
- **`notifications`** — first-class inbox row per recipient. RLS is
  **user + tenant** scoped (`user_id = current_user_id() AND tenant_id =
  current_tenant_id()`).
- **`users.email_notifications_enabled`** — boolean opt-out, default `true`.
- Migration `0014_phase1.2_notifications.sql` also defines the
  `current_user_id()` SQL helper (mirror of `current_tenant_id()`), reading the
  `app.current_user_id` GUC that `tenantContext` / `trpc.runInTenantTx` set.

## Auto-watch

Users become watchers automatically — done in the routers, not a DB trigger:
- `card.create` → creator watches (best-effort on the request tx).
- `comment.create` → commenter watches (same tx, `ON CONFLICT DO NOTHING`).
Explicit watch/unwatch is exposed via `notification.watchCard/unwatchCard`.

## Fan-out (outbox-worker)

- Handlers register per event type in `apps/outbox-worker/src/handlers/index.ts`.
- `cardNotificationHandler` handles `card.updated`, `card.assignee_added`,
  `card.due_date_updated`, `comment.created`, `checklist.item_updated`.
  `boardNotificationHandler` handles `board.member.added/removed`.
- Card events do **not** carry `tenantId` in the payload → handler looks it up
  from `cards`. The worker runs under a BYPASSRLS service role, so it can read
  watchers and insert notifications across tenants.
- The **actor is never notified** about their own action.
- `card.assignee_added` notifies only the assignee; other card events notify
  the card's watchers. `checklist.item_updated` only notifies when
  `changes.isDone` is present.
- Persian text is built by `buildNotificationText` in
  `@repo/infrastructure/notifications` (pure, dependency-free).

## Real-time + email

- After persisting, the handler publishes to Redis channel
  `user:{userId}:notifications`. The ws-server subscribes per authenticated
  connection and forwards `{ type: "NOTIFICATION", payload }` to all of the
  user's sockets.
- Email is opt-in (`email_notifications_enabled`) and rate-limited to
  **10 per user per hour** via a Redis key (`notif:email:{userId}`). Email and
  real-time push are best-effort — never block the notification insert.

## Client

- Shared zustand store at `src/lib/notifications/notificationStore.ts`
  (in `lib`, not a feature, so both `shell` and `board` features may import it
  without tripping the cross-feature boundary rule).
- `boardSocketClient` writes live `NOTIFICATION` pushes into the store.
- `NotificationsBell` has two tabs (اعلان‌ها / دعوت‌ها); badge reads the store,
  seeded from `sidebar.bootstrap.totalUnreadCount`.
- `/inbox` is the full paginated view (`InboxPage` feature).
- `CardWatchButton` lives in the card-detail header.

## sidebar.bootstrap

`totalUnreadCount = pendingInvitationsCount + unreadNotificationsCount`.
`pendingInvitationsCount` is retained for backward compatibility; clients
should prefer `totalUnreadCount`.

## Parked (future)

- Digest emails (daily/weekly).
- Notification settings page (granular per-event control).
- Browser/mobile push.
- Inbox filter-by-type, board-level watch.
- A dedicated app-wide notification WebSocket for live pushes on non-board
  pages (today live pushes arrive only while a board socket is connected).
