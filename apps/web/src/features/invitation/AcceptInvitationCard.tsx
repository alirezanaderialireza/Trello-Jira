"use client";

// apps/web/src/features/invitation/AcceptInvitationCard.tsx
//
// Card UI rendered on /invitations/[token]. Five mutually exclusive
// states (in order of precedence):
//
//   1. invitation.isRevoked              → red banner, no CTA.
//   2. invitation.isExpired              → amber banner, no CTA.
//   3. invitation.isAcceptedByCurrentUser→ green banner + link to
//                                          /workspaces/[slug].
//   4. !isLoggedIn                       → invitation summary +
//                                          "ورود/ثبت‌نام" CTA pointing
//                                          at /login?callbackUrl=...
//   5. isLoggedIn (default)              → invitation summary +
//                                          "پذیرش دعوت" button +
//                                          current account chip.
//                                          On click → onAccept().
//
// Post-action:
//   • result.ok                          → toast + router.push(/workspaces/<slug>)
//   • result.isEmailMismatch             → switch to a 6th render
//                                          path that swaps the
//                                          accept button for a
//                                          "خروج و ورود با ایمیل
//                                          درست" sign-out button.
//   • other failures                     → toast.error with the
//                                          server-supplied Persian
//                                          message.
//
// All Persian copy is inline. Role labels are duplicated from
// features/shell/lib/roleLabels.ts because cross-feature imports
// are blocked by the boundaries linter (feature → feature is only
// allowed within the same feature folder).

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  LogOut,
  Mail,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";

import { toJalaliDisplay, utcFromServer } from "@/lib/date";

// ── Public types ─────────────────────────────────────────────────────────────

export type InvitationRole = "OWNER" | "ADMIN" | "MEMBER";

export interface InvitationDetails {
  workspaceName: string;
  workspaceSlug: string;
  invitedEmailMasked: string;
  role: InvitationRole;
  inviterDisplayName: string;
  /** ISO 8601 string from the server. */
  expiresAt: string;
  isRevoked: boolean;
  isExpired: boolean;
  isAcceptedByCurrentUser: boolean;
}

export type AcceptInvitationActionFn = (token: string) => Promise<{
  ok: boolean;
  workspaceId?: string;
  alreadyAccepted?: boolean;
  error?: string;
  isEmailMismatch?: boolean;
}>;

interface Props {
  token: string;
  invitation: InvitationDetails;
  isLoggedIn: boolean;
  currentUserEmail: string | null;
  currentUserDisplayName: string | null;
  onAccept: AcceptInvitationActionFn;
}

// ── Persian role label map (intentionally duplicated — see header) ───────────

const ROLE_LABELS: Record<InvitationRole, string> = {
  OWNER: "مالک",
  ADMIN: "مدیر",
  MEMBER: "عضو",
};

const CARD_CLASSES =
  "w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8";

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function AcceptInvitationCard({
  token,
  invitation,
  isLoggedIn,
  currentUserEmail,
  currentUserDisplayName,
  onAccept,
}: Props) {
  const router = useRouter();
  const [isAccepting, startAccept] = useTransition();
  // True after the action returns isEmailMismatch — keeps the user
  // on the page and switches the CTA to "sign out + sign back in".
  const [emailMismatch, setEmailMismatch] = useState(false);

  const expiresAtFormatted = formatJalaliDateTime(invitation.expiresAt);

  // ── 1. Revoked ─────────────────────────────────────────────────────────────
  if (invitation.isRevoked) {
    return (
      <div className={CARD_CLASSES}>
        <CardHeader workspaceName={invitation.workspaceName} />
        <StatusBlock
          icon={<XCircle className="h-6 w-6" aria-hidden="true" />}
          color="red"
          title="دعوت لغو شده است"
          message="این دعوت توسط مدیر فضای کاری لغو شده. اگر همچنان قصد عضویت دارید، از مدیر بخواهید دعوت جدیدی برایتان ارسال کند."
        />
      </div>
    );
  }

  // ── 2. Expired ─────────────────────────────────────────────────────────────
  if (invitation.isExpired) {
    return (
      <div className={CARD_CLASSES}>
        <CardHeader workspaceName={invitation.workspaceName} />
        <StatusBlock
          icon={<CalendarClock className="h-6 w-6" aria-hidden="true" />}
          color="amber"
          title="دعوت منقضی شده"
          message={`این دعوت در تاریخ ${expiresAtFormatted} منقضی شد. از مدیر فضای کاری بخواهید دعوت جدیدی برایتان ارسال کند.`}
        />
      </div>
    );
  }

  // ── 3. Already accepted by the current user ────────────────────────────────
  if (invitation.isAcceptedByCurrentUser) {
    return (
      <div className={CARD_CLASSES}>
        <CardHeader workspaceName={invitation.workspaceName} />
        <StatusBlock
          icon={<CheckCircle2 className="h-6 w-6" aria-hidden="true" />}
          color="green"
          title="قبلاً پذیرفته شده"
          message={`شما از قبل عضو فضای کاری «${invitation.workspaceName}» هستید.`}
        />
        <Link
          href={`/workspaces/${invitation.workspaceSlug}`}
          className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          ورود به فضای کاری
        </Link>
      </div>
    );
  }

  // ── Common: invitation details rendered for both logged-in and ─────────────
  //           logged-out audiences.
  const details = (
    <div className="mt-2 space-y-3 rounded-lg bg-slate-50 p-4">
      <DetailRow
        icon={<UserRound className="h-4 w-4 text-slate-400" aria-hidden="true" />}
        label="دعوت‌کننده"
        value={invitation.inviterDisplayName}
      />
      <DetailRow
        icon={<ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden="true" />}
        label="نقش پیشنهادی"
        value={ROLE_LABELS[invitation.role] ?? invitation.role}
      />
      <DetailRow
        icon={<Mail className="h-4 w-4 text-slate-400" aria-hidden="true" />}
        label="ایمیل دعوت‌شده"
        value={invitation.invitedEmailMasked}
      />
      <DetailRow
        icon={<CalendarClock className="h-4 w-4 text-slate-400" aria-hidden="true" />}
        label="تا تاریخ"
        value={expiresAtFormatted}
      />
    </div>
  );

  // ── 4. Logged out ──────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    const callbackUrl = `/invitations/${encodeURIComponent(token)}`;
    return (
      <div className={CARD_CLASSES}>
        <CardHeader workspaceName={invitation.workspaceName} />
        {details}
        <p className="mt-5 text-sm leading-7 text-slate-600">
          برای پذیرش این دعوت ابتدا وارد حساب کاربری خود شوید یا با همان ایمیل
          ثبت‌نام کنید.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            ورود به حساب
          </Link>
          <Link
            href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="inline-flex flex-1 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ثبت‌نام
          </Link>
        </div>
      </div>
    );
  }

  // ── 5 & 6. Logged in ───────────────────────────────────────────────────────
  // Default state shows the accept button. After an EMAIL_MISMATCH
  // failure we swap it for a sign-out CTA so the recipient can come
  // back with the correct account.

  const handleAccept = () => {
    startAccept(async () => {
      const result = await onAccept(token);

      if (result.ok) {
        if (result.alreadyAccepted) {
          toast.success(
            `شما از قبل عضو «${invitation.workspaceName}» بودید — به فضای کاری منتقل می‌شوید.`,
          );
        } else {
          toast.success(`دعوت پذیرفته شد — به «${invitation.workspaceName}» خوش آمدید!`);
        }
        router.push(`/workspaces/${invitation.workspaceSlug}`);
        return;
      }

      if (result.isEmailMismatch) {
        setEmailMismatch(true);
      }

      toast.error(result.error ?? "خطا در پذیرش دعوت.");
    });
  };

  const handleSignOutAndRetry = () => {
    // After signOut, NextAuth bounces to the callbackUrl. The /login
    // page reads `callbackUrl` from search params, so the user is
    // returned to this invitation page after they sign back in.
    const callbackUrl = `/invitations/${encodeURIComponent(token)}`;
    void signOut({
      callbackUrl: `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    });
  };

  return (
    <div className={CARD_CLASSES}>
      <CardHeader workspaceName={invitation.workspaceName} />
      {details}

      {emailMismatch ? (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600"
              aria-hidden="true"
            />
            <div className="flex-1 text-sm leading-7 text-red-800">
              <p className="font-medium">این دعوت برای ایمیل دیگری ارسال شده.</p>
              <p className="mt-1 text-red-700">
                برای پذیرش، با همان ایمیلی که دعوت برایش ارسال شده وارد شوید.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOutAndRetry}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            خروج و ورود با ایمیل درست
          </button>
        </div>
      ) : (
        <>
          {currentUserEmail && (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-500">
              وارد شده با حساب{" "}
              <strong className="text-slate-700">
                {currentUserDisplayName ?? currentUserEmail}
              </strong>
              {currentUserDisplayName && (
                <>
                  {" "}
                  (<span dir="ltr">{currentUserEmail}</span>)
                </>
              )}
            </p>
          )}
          <button
            type="button"
            onClick={handleAccept}
            disabled={isAccepting}
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAccepting ? "در حال پذیرش..." : "پذیرش دعوت"}
          </button>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function CardHeader({ workspaceName }: { workspaceName: string }) {
  return (
    <div className="mb-5 flex items-center gap-3 border-b border-slate-200 pb-4">
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-blue-100">
        <Building2 className="h-6 w-6 text-blue-600" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <h1
          dir="auto"
          className="truncate text-lg font-bold text-slate-900"
          title={workspaceName}
        >
          {workspaceName}
        </h1>
        <p className="text-sm text-slate-500">دعوت به فضای کاری</p>
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span className="text-slate-500">{label}:</span>
      <span dir="auto" className="font-medium text-slate-900">
        {value}
      </span>
    </div>
  );
}

function StatusBlock({
  icon,
  color,
  title,
  message,
}: {
  icon: React.ReactNode;
  color: "red" | "amber" | "green";
  title: string;
  message: string;
}) {
  const palette = {
    red: { bg: "bg-red-50", border: "border-red-200", iconText: "text-red-600", titleText: "text-red-900", bodyText: "text-red-800" },
    amber: { bg: "bg-amber-50", border: "border-amber-200", iconText: "text-amber-600", titleText: "text-amber-900", bodyText: "text-amber-800" },
    green: { bg: "bg-green-50", border: "border-green-200", iconText: "text-green-600", titleText: "text-green-900", bodyText: "text-green-800" },
  }[color];
  return (
    <div className={`rounded-lg border ${palette.border} ${palette.bg} p-4`}>
      <div className="flex items-start gap-3">
        <div className={palette.iconText}>{icon}</div>
        <div className="flex-1 text-sm leading-7">
          <p className={`font-medium ${palette.titleText}`}>{title}</p>
          <p className={`mt-1 ${palette.bodyText}`}>{message}</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatJalaliDateTime(iso: string): string {
  try {
    return toJalaliDisplay(utcFromServer(iso), undefined, "YYYY/MM/DD HH:mm");
  } catch {
    // Defensive: malformed ISO string from API. Surface the raw
    // value so the user still sees something rather than a blank.
    return iso;
  }
}
