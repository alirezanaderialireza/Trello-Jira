// packages/infrastructure/src/email/templates/notification.ts
//
// Phase 1.2 (F1.2.9) — Persian RTL email sent when a watched card (or board
// membership) changes and the recipient has email notifications enabled.
// Rendered by the outbox-worker notification handlers.
//
// Variables:
//   • title      — the notification title (already plain Persian text)
//   • body       — the notification body (may be empty)
//   • actorName  — display name of the actor that triggered the event
//   • actionUrl  — optional absolute URL to the related card / inbox; when
//                  present an "open" button is rendered.
//
// The text fallback is mandatory for spam-filter scoring and text-only
// mail clients.

import { escapeHtml, wrapHtmlBody } from "./_shared";

export interface NotificationEmailParams {
  title: string;
  body: string;
  actorName: string;
  actionUrl?: string;
}

export function notificationSubject(
  params: Pick<NotificationEmailParams, "title">,
): string {
  return params.title;
}

export function notificationHtml(params: NotificationEmailParams): string {
  const title = escapeHtml(params.title);
  const body = params.body ? escapeHtml(params.body) : "";
  const actionUrl = params.actionUrl ? escapeHtml(params.actionUrl) : "";

  const bodyBlock = body
    ? `<p style="color:#334155;line-height:1.7;margin:0 0 24px;font-size:14px;">
          ${body}
        </p>`
    : "";

  const buttonBlock = actionUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:#2563eb;border-radius:8px;">
              <a href="${actionUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;">
                مشاهده
              </a>
            </td>
          </tr>
        </table>
        <p style="color:#64748b;font-size:12px;margin:24px 0 0;line-height:1.6;">
          اگر دکمه بالا کار نکرد، این آدرس را در مرورگر باز کنید:
          <br />
          <a href="${actionUrl}" style="color:#2563eb;word-break:break-all;">${actionUrl}</a>
        </p>`
    : "";

  const inner = `        <h2 style="color:#0f172a;margin:0 0 16px;font-size:20px;font-weight:bold;">
          ${title}
        </h2>
        ${bodyBlock}
        ${buttonBlock}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
        <p style="color:#94a3b8;font-size:12px;margin:0;line-height:1.6;">
          این ایمیل به این دلیل برای شما ارسال شد که اعلان‌های ایمیلی فعال است.
          می‌توانید آن را از تنظیمات حساب خود غیرفعال کنید.
        </p>`;

  return wrapHtmlBody(inner);
}

export function notificationText(params: NotificationEmailParams): string {
  const lines = [params.title, ""];
  if (params.body) {
    lines.push(params.body, "");
  }
  if (params.actionUrl) {
    lines.push("مشاهده:", params.actionUrl, "");
  }
  lines.push(
    "این ایمیل به این دلیل برای شما ارسال شد که اعلان‌های ایمیلی فعال است.",
  );
  return lines.join("\n");
}
