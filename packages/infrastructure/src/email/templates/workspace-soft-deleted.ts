// packages/infrastructure/src/email/templates/workspace-soft-deleted.ts
//
// Persian RTL email sent to the workspace owner when their workspace
// transitions to the soft-deleted state. The 30-day grace window is
// configured in domain layer (see softDeleteWorkspace use case);
// during this window the owner can restore via the recovery link.
//
// NOTE (F5a scope): this template ships ahead of its consumer. The
// outbox-worker handler that consumes `workspace.deleted` events and
// dispatches this email is NOT wired in F5a — the template exists so
// the future handler PR can render emails immediately without first
// re-introducing the template. Kept tree-shakeable; unused exports
// add zero bundle weight to existing consumers.
//
// Variables:
//   • ownerName             — display name of the workspace owner
//   • workspaceName         — display name of the deleted workspace
//   • restoreUrl            — absolute URL to /workspaces (or to a
//                             dedicated restore CTA if added later)
//   • permanentDeleteAtFmt  — Persian-formatted timestamp at which
//                             the soft-delete becomes permanent.

import { escapeHtml, wrapHtmlBody } from "./_shared";

export interface WorkspaceSoftDeletedEmailParams {
  ownerName: string;
  workspaceName: string;
  restoreUrl: string;
  permanentDeleteAtFmt: string;
}

export function workspaceSoftDeletedSubject(
  params: Pick<WorkspaceSoftDeletedEmailParams, "workspaceName">,
): string {
  return `حذف فضای کاری «${params.workspaceName}»`;
}

export function workspaceSoftDeletedHtml(
  params: WorkspaceSoftDeletedEmailParams,
): string {
  const ownerName = escapeHtml(params.ownerName);
  const workspaceName = escapeHtml(params.workspaceName);
  const restoreUrl = escapeHtml(params.restoreUrl);
  const permanentDeleteAtFmt = escapeHtml(params.permanentDeleteAtFmt);

  const inner = `        <h2 style="color:#0f172a;margin:0 0 16px;font-size:20px;font-weight:bold;">
          فضای کاری شما حذف شد
        </h2>
        <p style="color:#334155;line-height:1.7;margin:0 0 12px;font-size:14px;">
          ${ownerName} عزیز،
        </p>
        <p style="color:#334155;line-height:1.7;margin:0 0 12px;font-size:14px;">
          فضای کاری <strong>«${workspaceName}»</strong> به‌درخواست شما حذف شد.
          داده‌های آن تا <strong>${permanentDeleteAtFmt}</strong> در سامانه نگه داشته می‌شوند
          و در این بازه می‌توانید آن را بازگردانی کنید.
        </p>
        <p style="color:#334155;line-height:1.7;margin:0 0 24px;font-size:14px;">
          پس از این تاریخ، فضای کاری و تمام داده‌های آن به‌طور دائمی حذف خواهند شد.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:#2563eb;border-radius:8px;">
              <a href="${restoreUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;">
                مدیریت فضاهای کاری
              </a>
            </td>
          </tr>
        </table>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
        <p style="color:#94a3b8;font-size:12px;margin:0;line-height:1.6;">
          اگر این عملیات را شما انجام نداده‌اید، فوراً وارد حساب خود شوید و فضای کاری را بازگردانی کنید.
        </p>`;

  return wrapHtmlBody(inner);
}

export function workspaceSoftDeletedText(
  params: WorkspaceSoftDeletedEmailParams,
): string {
  return [
    `حذف فضای کاری «${params.workspaceName}»`,
    "",
    `${params.ownerName} عزیز،`,
    "",
    `فضای کاری «${params.workspaceName}» به‌درخواست شما حذف شد. داده‌های آن تا ${params.permanentDeleteAtFmt} در سامانه نگه داشته می‌شوند و در این بازه می‌توانید آن را بازگردانی کنید.`,
    "",
    "پس از این تاریخ، فضای کاری و تمام داده‌های آن به‌طور دائمی حذف خواهند شد.",
    "",
    "مدیریت فضاهای کاری:",
    params.restoreUrl,
    "",
    "اگر این عملیات را شما انجام نداده‌اید، فوراً وارد حساب خود شوید و فضای کاری را بازگردانی کنید.",
  ].join("\n");
}
