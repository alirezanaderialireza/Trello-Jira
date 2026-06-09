// apps/outbox-worker/src/handlers/cardNotification.handler.ts
//
// Phase 1.2 (F1.2.9) — fan-out handler for card-scoped events that produce
// Inbox notifications for the card's watchers.
//
// Registered for: card.updated, card.assignee_added, card.due_date_updated,
// comment.created, checklist.item_updated (see handlers/index.ts).
//
// Flow (runs inside the same tx as the outbox claim — see ../index.ts):
//   1. Resolve cardId + tenantId (card events do NOT carry tenantId in the
//      payload, so we look it up from `cards`). The worker runs under a
//      BYPASSRLS service role, so this read is not tenant-gated.
//   2. Resolve the actor id (per event type) + actor display name.
//   3. Build the Persian { title, body } via buildNotificationText.
//   4. Determine recipients:
//        • card.assignee_added → only the newly-assigned user.
//        • everything else     → the card's watchers.
//      The actor is always excluded (no self-notifications — guard D-G1).
//   5. Insert one notification row per recipient, publish a real-time push
//      to `user:{userId}:notifications`, and optionally send an email
//      (opt-in + rate-limited).
//
// ─── RLS / role note ─────────────────────────────────────────────────────────
// notifications + card_watchers enable FORCE row-level security. The worker
// connects via DATABASE_URL which in production is the BYPASSRLS app_service
// role (and a superuser in CI), so these queries are not blocked. If the
// worker is ever run under a non-bypass role, watcher reads return empty and
// no notifications are produced — fail-closed, not fail-open.

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";

import {
  buildNotificationText,
} from "@repo/infrastructure/notifications";
import {
  createEmailSender,
  notificationHtml,
  notificationText,
  type EmailSender,
} from "@repo/infrastructure/email";

import type { EventHandler } from "../types";

// ── Module-level singletons ──────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const emailSender: EmailSender = createEmailSender();

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Max notification emails per user per hour (Redis-guarded).
const EMAIL_RATE_LIMIT_PER_HOUR = 10;

// Events this handler produces notifications for.
const NOTIFICATION_EVENTS = new Set<string>([
  "card.updated",
  "card.assignee_added",
  "card.due_date_updated",
  "comment.created",
  "checklist.item_updated",
]);

// ── tx surface ───────────────────────────────────────────────────────────────

type ExecutableTx = {
  execute: (query: ReturnType<typeof sql>) => Promise<readonly Record<string, unknown>[]>;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Resolve the actor (the user who triggered the event) for each event type.
 * Some events (card.updated, checklist.item_updated) carry no actor — those
 * return undefined and the notification text falls back to «کاربر».
 */
function resolveActorId(type: string, payload: Record<string, unknown>): string | undefined {
  switch (type) {
    case "comment.created":
      return strField(payload, "authorId");
    case "card.assignee_added":
      return strField(payload, "assignedBy");
    case "card.due_date_updated":
      return strField(payload, "updatedBy");
    default:
      return strField(payload, "actorId");
  }
}

async function maybeSendEmail(
  tx: ExecutableTx,
  userId: string,
  title: string,
  body: string,
  actorName: string,
  cardId: string | undefined,
): Promise<void> {
  const rows = await tx.execute(sql`
    SELECT email, email_notifications_enabled
    FROM users
    WHERE id::text = ${userId}
    LIMIT 1
  `);
  const row = rows[0] as { email?: string; email_notifications_enabled?: boolean } | undefined;
  if (!row?.email || row.email_notifications_enabled === false) return;

  // Rate limit: max EMAIL_RATE_LIMIT_PER_HOUR emails per user per hour.
  const rateLimitKey = `notif:email:${userId}`;
  const current = await redis.incr(rateLimitKey);
  if (current === 1) await redis.expire(rateLimitKey, 3600);
  if (current > EMAIL_RATE_LIMIT_PER_HOUR) return;

  const actionUrl = cardId ? `${APP_BASE_URL}/inbox` : undefined;
  const params = { title, body, actorName, actionUrl };

  await emailSender.send({
    to: row.email,
    subject: title,
    html: notificationHtml(params),
    text: notificationText(params),
  });
}

// ── Handler ──────────────────────────────────────────────────────────────────

export const cardNotificationHandler: EventHandler = async (ctx) => {
  const { type, payload } = ctx.event;
  if (!NOTIFICATION_EVENTS.has(type)) return;

  // For checklist items we only notify when the done-state actually changed.
  if (type === "checklist.item_updated") {
    const changes = (payload.changes ?? {}) as Record<string, unknown>;
    if (!("isDone" in changes)) return;
  }

  const tx = ctx.tx as ExecutableTx;

  const cardId = strField(payload, "cardId") ?? ctx.event.aggregate_id;
  const boardId = strField(payload, "boardId") ?? null;
  if (!cardId) return;

  // ── 1. tenant_id (card events don't carry it in the payload) ──────────────
  const cardRows = await tx.execute(sql`
    SELECT tenant_id FROM cards WHERE id = ${cardId} LIMIT 1
  `);
  const tenantId = (cardRows[0] as { tenant_id?: string } | undefined)?.tenant_id;
  if (!tenantId) return; // card vanished (hard-deleted) — nothing to do.

  // ── 2. actor id + display name ────────────────────────────────────────────
  const actorId = resolveActorId(type, payload);
  let actorName = "کاربر";
  if (actorId) {
    const actorRows = await tx.execute(sql`
      SELECT display_name FROM users WHERE id::text = ${actorId} LIMIT 1
    `);
    actorName = (actorRows[0] as { display_name?: string } | undefined)?.display_name ?? "کاربر";
  }

  // ── 3. notification text ──────────────────────────────────────────────────
  const { title, body } = buildNotificationText(type, payload, actorName);

  // ── 4. recipients ─────────────────────────────────────────────────────────
  let recipients: string[];
  if (type === "card.assignee_added") {
    const assigneeId = strField(payload, "assigneeId");
    recipients = assigneeId ? [assigneeId] : [];
  } else {
    const watcherRows = await tx.execute(sql`
      SELECT user_id FROM card_watchers WHERE card_id = ${cardId}
    `);
    recipients = watcherRows.map((r) => (r as { user_id: string }).user_id);
  }

  // Never notify the actor about their own action.
  const finalRecipients = recipients.filter((uid) => uid && uid !== actorId);
  if (finalRecipients.length === 0) return;

  // ── 5. insert + push + email per recipient ────────────────────────────────
  for (const userId of finalRecipients) {
    const notifId = randomUUID();

    await tx.execute(sql`
      INSERT INTO notifications
        (id, tenant_id, user_id, type, entity_type, entity_id,
         board_id, card_id, actor_id, actor_name, title, body)
      VALUES
        (${notifId}, ${tenantId}, ${userId}, ${type}, 'card', ${cardId},
         ${boardId}, ${cardId}, ${actorId ?? ""}, ${actorName}, ${title}, ${body})
      ON CONFLICT DO NOTHING
    `);

    try {
      await redis.publish(
        `user:${userId}:notifications`,
        JSON.stringify({
          type: "NEW_NOTIFICATION",
          notificationId: notifId,
          notifType: type,
          title,
          body,
          cardId,
          boardId,
          createdAt: new Date().toISOString(),
        }),
      );
    } catch (err) {
      // Real-time push is best-effort; the row is already persisted so the
      // recipient will see it on next fetch. Do not fail the handler.
      console.warn(`[cardNotification] redis publish failed for ${userId}:`, (err as Error)?.message);
    }

    try {
      await maybeSendEmail(tx, userId, title, body, actorName, cardId);
    } catch (err) {
      // Email is best-effort too — never block the notification on it.
      console.warn(`[cardNotification] email send failed for ${userId}:`, (err as Error)?.message);
    }
  }
};
