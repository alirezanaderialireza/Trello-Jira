// packages/infrastructure/src/email/templates/workspace-invitation.ts
//
// Persian RTL email sent when an admin invites a new member to a
// workspace. Triggered by the `workspace.invitation.created` outbox
// event; the outbox-worker email handler renders this template and
// hands the result to the configured `EmailSender`.
//
// Variables (all required, all already escaped where they will land
// in HTML — see `_shared.ts`):
//   • workspaceName       — display name of the target workspace
//   • inviterName         — display name of the admin who invited
//   • roleLabel           — Persian role chip (مالک / مدیر / عضو)
//   • acceptUrl           — absolute URL to /invitations/[token]
//   • expiresAtFormatted  — Persian-formatted expiry date string
//                           (caller formats; templates stay
//                           dependency-free of date libs).
//
// The text fallback is mandatory for spam-filter scoring and for the
// (small but real) cohort of users on text-only mail clients.

import { escapeHtml, wrapHtmlBody } from "./_shared";

export interface WorkspaceInvitationEmailParams {
  workspaceName: string;
  inviterName: string;
  roleLabel: string;
  acceptUrl: string;
  expiresAtFormatted: string;
}

export function workspaceInvitationSubject(
  params: Pick<WorkspaceInvitationEmailParams, "workspaceName">,
): string {
  return `دعوت به فضای کاری «${params.workspaceName}»`;
}

export function workspaceInvitationHtml(
  params: WorkspaceInvitationEmailParams,
): string {
  const workspaceName = escapeHtml(params.workspaceName);
  const inviterName = escapeHtml(params.inviterName);
  const roleLabel = escapeHtml(params.roleLabel);
  const acceptUrl = escapeHtml(params.acceptUrl);
  const expiresAtFormatted = escapeHtml(params.expiresAtFormatted);

  const inner = `        <h2 style="color:#0f172a;margin:0 0 16px;font-size:20px;font-weight:bold;">
          دعوت به فضای کاری
        </h2>
        <p style="color:#334155;line-height:1.7;margin:0 0 12px;font-size:14px;">
          <strong>${inviterName}</strong> شما را به فضای کاری
          <strong>«${workspaceName}»</strong> با نقش
          <strong>${roleLabel}</strong> دعوت کرده است.
        </p>
        <p style="color:#334155;line-height:1.7;margin:0 0 24px;font-size:14px;">
          برای پذیرش این دعوت روی دکمه زیر کلیک کنید:
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:#2563eb;border-radius:8px;">
              <a href="${acceptUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;">
                پذیرش دعوت
              </a>
            </td>
          </tr>
        </table>
        <p style="color:#64748b;font-size:12px;margin:24px 0 0;line-height:1.6;">
          اگر دکمه بالا کار نکرد، این آدرس را در مرورگر باز کنید:
          <br />
          <a href="${acceptUrl}" style="color:#2563eb;word-break:break-all;">${acceptUrl}</a>
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
        <p style="color:#94a3b8;font-size:12px;margin:0 0 8px;line-height:1.6;">
          این دعوت تا تاریخ <strong>${expiresAtFormatted}</strong> معتبر است.
          در صورت عدم پذیرش، خودبه‌خود منقضی می‌شود.
        </p>
        <p style="color:#94a3b8;font-size:12px;margin:0;line-height:1.6;">
          اگر این دعوت را انتظار نداشته‌اید، این ایمیل را نادیده بگیرید.
        </p>`;

  return wrapHtmlBody(inner);
}

export function workspaceInvitationText(
  params: WorkspaceInvitationEmailParams,
): string {
  return [
    `دعوت به فضای کاری «${params.workspaceName}»`,
    "",
    `${params.inviterName} شما را به فضای کاری «${params.workspaceName}» با نقش ${params.roleLabel} دعوت کرده است.`,
    "",
    "برای پذیرش دعوت به این لینک مراجعه کنید:",
    params.acceptUrl,
    "",
    `این دعوت تا تاریخ ${params.expiresAtFormatted} معتبر است.`,
    "",
    "اگر این دعوت را انتظار نداشته‌اید، این ایمیل را نادیده بگیرید.",
  ].join("\n");
}
