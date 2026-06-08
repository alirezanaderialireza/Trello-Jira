// packages/infrastructure/src/notifications/notificationText.ts
//
// Phase 1.2 (F1.2.9) — pure builder that turns an outbox event type + payload
// into the Persian { title, body } shown in the Inbox / NotificationsBell and
// the notification email.
//
// Kept dependency-free and side-effect-free so both the outbox-worker (Node)
// and any test can call it. The worker passes the actor's display name
// (looked up from `users`); when the actor cannot be resolved the worker
// passes the fallback «کاربر».
//
// The function never throws — an unknown event type falls back to a generic
// title so a future event wired into the handler map without a text entry
// still produces a usable (if generic) notification.

export interface NotificationText {
  title: string;
  body: string;
}

const FALLBACK_ACTOR = "کاربر";
const COMMENT_PREVIEW_MAX = 100;

/**
 * Format a `YYYY-MM-DD` due date into a Persian (Jalali) calendar string.
 * Falls back to the raw value if the input is malformed.
 */
function formatJalaliDate(ymd: string): string {
  try {
    return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("fa-IR-u-ca-persian", {
      year:  "numeric",
      month: "long",
      day:   "numeric",
    });
  } catch {
    return ymd;
  }
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function buildNotificationText(
  eventType: string,
  payload:   Record<string, unknown>,
  actorName: string,
): NotificationText {
  const actor = str(actorName) ?? FALLBACK_ACTOR;

  switch (eventType) {
    case "card.updated": {
      const changes = (payload.changes ?? {}) as Record<string, unknown>;
      const newTitle = str(changes.title);
      return {
        title: `${actor} کارت را ویرایش کرد`,
        body:  newTitle ? `عنوان: ${newTitle}` : "",
      };
    }

    case "card.assignee_added": {
      const cardTitle = str(payload.cardTitle);
      return {
        title: `${actor} شما را به کارت اضافه کرد`,
        body:  cardTitle ? `در کارت: ${cardTitle}` : "",
      };
    }

    case "card.due_date_updated": {
      const newDueDate = str(payload.newDueDate);
      return {
        title: "تاریخ سررسید تغییر کرد",
        body:  newDueDate ? `سررسید: ${formatJalaliDate(newDueDate)}` : "سررسید حذف شد",
      };
    }

    case "comment.created": {
      const commentBody = str(payload.body);
      return {
        title: `${actor} نظر جدید گذاشت`,
        body:  commentBody ? truncate(commentBody, COMMENT_PREVIEW_MAX) : "",
      };
    }

    case "checklist.item_updated": {
      const changes = (payload.changes ?? {}) as Record<string, unknown>;
      const text = str(changes.text);
      return {
        title: "آیتم چک‌لیست تکمیل شد",
        body:  text ? `${actor}: ${text}` : actor,
      };
    }

    case "board.member.added": {
      return {
        title: "به برد اضافه شدید",
        body:  `${actor} شما را به برد اضافه کرد`,
      };
    }

    case "board.member.removed": {
      return {
        title: "از برد حذف شدید",
        body:  `${actor} شما را از برد حذف کرد`,
      };
    }

    default: {
      return {
        title: "اعلان جدید",
        body:  "",
      };
    }
  }
}
