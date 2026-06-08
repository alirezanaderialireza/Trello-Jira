// apps/outbox-worker/src/handlers/boardNotification.handler.ts
//
// Phase 1.2 (F1.2.9) — board-membership events that notify a single affected
// user (not the whole board).
//
// Registered for: board.member.added, board.member.removed.
//
//   • board.member.added   payload { boardId, tenantId, userId, role, addedBy }
//   • board.member.removed payload { boardId, userId, removedBy } (no tenantId
//                           in the payload → looked up from `boards`).
//
// The recipient is always the affected member (`payload.userId`). We never
// notify the actor about their own action (guard D-G1). Runs inside the same
// tx as the outbox claim, under the worker's BYPASSRLS role.

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";

import { buildNotificationText } from "@repo/infrastructure/notifications";
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
const EMAIL_RATE_LIMIT_PER_HOUR = 10;

const NOTIFICATION_EVENTS = new Set<string>([
  "board.member.added",
  "board.member.removed",
]);

type ExecutableTx = {
  execute: (query: ReturnType<typeof sql>) => Promise<readonly Record<string, unknown>[]>;
};

function strField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

async function maybeSendEmail(
  tx: ExecutableTx,
  userId: string,
  title: string,
  body: string,
  actorName: string,
): Promise<void> {
  const rows = await tx.execute(sql`
    SELECT email, email_notifications_enabled
    FROM users
    WHERE id::text = ${userId}
    LIMIT 1
  `);
  const row = rows[0] as { email?: string; email_notifications_enabled?: boolean } | undefined;
  if (!row?.email || row.email_notifications_enabled === false) return;

  const rateLimitKey = `notif:email:${userId}`;
  const current = await redis.incr(rateLimitKey);
  if (current === 1) await redis.expire(rateLimitKey, 3600);
  if (current > EMAIL_RATE_LIMIT_PER_HOUR) return;

  const params = { title, body, actorName, actionUrl: `${APP_BASE_URL}/inbox` };
  await emailSender.send({
    to: row.email,
    subject: title,
    html: notificationHtml(params),
    text: notificationText(params),
  });
}

export const boardNotificationHandler: EventHandler = async (ctx) => {
  const { type, payload } = ctx.event;
  if (!NOTIFICATION_EVENTS.has(type)) return;

  const tx = ctx.tx as ExecutableTx;

  const boardId = strField(payload, "boardId") ?? ctx.event.aggregate_id;
  const recipientId = strField(payload, "userId");
  if (!boardId || !recipientId) return;

  const actorId =
    strField(payload, "addedBy") ?? strField(payload, "removedBy") ?? strField(payload, "actorId");

  // Never notify the actor about their own action.
  if (actorId && actorId === recipientId) return;

  // ── tenant_id: in payload for added, looked up for removed ────────────────
  let tenantId = strField(payload, "tenantId");
  if (!tenantId) {
    const boardRows = await tx.execute(sql`
      SELECT tenant_id FROM boards WHERE id = ${boardId} LIMIT 1
    `);
    tenantId = (boardRows[0] as { tenant_id?: string } | undefined)?.tenant_id;
  }
  if (!tenantId) return;

  // ── actor display name ────────────────────────────────────────────────────
  let actorName = "کاربر";
  if (actorId) {
    const actorRows = await tx.execute(sql`
      SELECT display_name FROM users WHERE id::text = ${actorId} LIMIT 1
    `);
    actorName = (actorRows[0] as { display_name?: string } | undefined)?.display_name ?? "کاربر";
  }

  const { title, body } = buildNotificationText(type, payload, actorName);

  const notifId = randomUUID();
  await tx.execute(sql`
    INSERT INTO notifications
      (id, tenant_id, user_id, type, entity_type, entity_id,
       board_id, card_id, actor_id, actor_name, title, body)
    VALUES
      (${notifId}, ${tenantId}, ${recipientId}, ${type}, 'board', ${boardId},
       ${boardId}, ${null}, ${actorId ?? ""}, ${actorName}, ${title}, ${body})
    ON CONFLICT DO NOTHING
  `);

  try {
    await redis.publish(
      `user:${recipientId}:notifications`,
      JSON.stringify({
        type: "NEW_NOTIFICATION",
        notificationId: notifId,
        notifType: type,
        title,
        body,
        boardId,
        createdAt: new Date().toISOString(),
      }),
    );
  } catch (err) {
    console.warn(`[boardNotification] redis publish failed for ${recipientId}:`, (err as Error)?.message);
  }

  try {
    await maybeSendEmail(tx, recipientId, title, body, actorName);
  } catch (err) {
    console.warn(`[boardNotification] email send failed for ${recipientId}:`, (err as Error)?.message);
  }
};
