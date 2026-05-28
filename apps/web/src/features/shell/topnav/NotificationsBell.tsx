"use client";

// apps/web/src/features/shell/topnav/NotificationsBell.tsx
//
// Bell icon + popover for the user's pending workspace invitations.
//
// Data flow:
//   • Initial count (no list) is already in `sidebar.bootstrap`'s
//     `pendingInvitationsCount`. The TopNav passes it in via prop so
//     the badge renders without an extra round-trip.
//   • When the popover opens, we fetch the first-5 list via
//     `workspace.invitations.getMyPending`. The query is `enabled`
//     only after the user opens the bell — keeps the cold path off
//     unauthenticated traffic.
//   • Click "همه دعوت‌ها" → /invitations (Phase 1.2 lands the page).
//
// Empty state: a plain "دعوت معلقی ندارید". An empty popover with no
// CTA is acceptable here — the user doesn't create their own
// invitations from this surface.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import { trpc } from "../../../utils/trpc";
import { toJalaliDisplay, type UTCDateTime } from "../../../lib/date";
import { getWorkspaceRoleLabel } from "../lib/roleLabels";

interface NotificationsBellProps {
  initialCount: number;
  /** User timezone, for جلالی date formatting in the popover items. */
  userTimezone: string;
}

/** Cap the in-popover preview at this many items; "see all" handles the rest. */
const PREVIEW_LIMIT = 5;

export function NotificationsBell({
  initialCount,
  userTimezone,
}: NotificationsBellProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Fetch the list lazily — only when the popover is opened. The
  // initial badge count comes from sidebar.bootstrap so the bell is
  // accurate without any cold load.
  const { data: invitations, isLoading } =
    trpc.v1.public.workspace.invitations.getMyPending.useQuery(undefined, {
      enabled: open,
      staleTime: 30_000,
    });

  // Outside-click + Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (
        t &&
        popoverRef.current &&
        !popoverRef.current.contains(t) &&
        !triggerRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const list = invitations ?? [];
  const preview = list.slice(0, PREVIEW_LIMIT);
  const hasMore = list.length > PREVIEW_LIMIT;

  // The badge tracks the live data once we've fetched it; falls back
  // to the initial count from bootstrap until then. Pending=0 hides
  // the badge dot entirely.
  const displayCount = invitations !== undefined ? invitations.length : initialCount;
  const showBadge = displayCount > 0;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          showBadge
            ? `اعلان‌ها (${displayCount} مورد)`
            : "اعلان‌ها"
        }
        className="
          relative flex h-9 w-9 items-center justify-center rounded-md
          text-slate-600 hover:bg-slate-100
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        "
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {showBadge && (
          <span
            aria-hidden="true"
            className="
              absolute -top-0.5 end-0.5 flex h-4 min-w-4 items-center justify-center
              rounded-full bg-red-600 px-1 text-[10px] font-bold text-white
            "
          >
            {displayCount > 9 ? "+۹" : displayCount.toLocaleString("fa-IR")}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="اعلان‌ها"
          className="
            absolute end-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-md
            border border-slate-200 bg-white shadow-lg
          "
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-900">دعوت‌ها</h2>
          </div>

          {isLoading ? (
            <div className="space-y-2 p-3" aria-busy="true">
              <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
              <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
              <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
            </div>
          ) : preview.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-slate-500">
              دعوت معلقی ندارید.
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
              {preview.map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={`/invitations/${inv.id}`}
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2 hover:bg-slate-50"
                  >
                    <div className="text-sm font-medium text-slate-900" dir="auto">
                      {inv.workspaceName}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      نقش پیشنهادی: {getWorkspaceRoleLabel(inv.role)}
                      {" · تا "}
                      {formatExpires(inv.expiresAt, userTimezone)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {(hasMore || preview.length > 0) && (
            <div className="border-t border-slate-100">
              <Link
                href="/invitations"
                onClick={() => setOpen(false)}
                className="
                  block px-3 py-2 text-center text-sm text-blue-600
                  hover:bg-blue-50
                "
              >
                {hasMore
                  ? `همه دعوت‌ها (${list.length.toLocaleString("fa-IR")})`
                  : "همه دعوت‌ها"}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatExpires(iso: string, tz: string): string {
  try {
    return toJalaliDisplay(iso as UTCDateTime, tz, "YYYY/MM/DD");
  } catch {
    return "";
  }
}
