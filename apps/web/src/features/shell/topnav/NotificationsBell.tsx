"use client";

// apps/web/src/features/shell/topnav/NotificationsBell.tsx
//
// Phase 1.2 (F1.2.9) — bell + popover with two tabs:
//   • «اعلان‌ها» — in-app notifications (v1.public.notification.list).
//   • «دعوت‌ها»  — pending workspace invitations (unchanged from F3b).
//
// The red badge reflects the combined unread count held in the shared
// notification store (seeded from sidebar.bootstrap.totalUnreadCount and
// bumped live by the board WebSocket — see useNotificationSocket /
// boardSocketClient). Lists are fetched lazily when the popover opens.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

import { trpc } from "../../../utils/trpc";
import { toJalaliDisplay, type UTCDateTime } from "../../../lib/date";
import { formatRelative } from "../../../lib/relativeTime";
import { UserAvatar } from "../../../components/users/UserAvatar";
import { useNotificationSocket } from "../hooks/useNotificationSocket";
import { useNotificationStore } from "../../../lib/notifications/notificationStore";
import { getWorkspaceRoleLabel } from "../lib/roleLabels";

interface NotificationsBellProps {
  /** Combined unread count from sidebar.bootstrap (invitations + notifications). */
  initialCount: number;
  /** User timezone, for جلالی date formatting in the invitations list. */
  userTimezone: string;
}

const PREVIEW_LIMIT = 5;

type Tab = "notifications" | "invitations";

export function NotificationsBell({
  initialCount,
  userTimezone,
}: NotificationsBellProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("notifications");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Live badge count from the shared store (seeded from bootstrap).
  const unreadCount = useNotificationSocket(initialCount);
  const storeMarkAllRead = useNotificationStore((s) => s.markAllRead);
  const storeMarkOneRead = useNotificationStore((s) => s.markOneRead);

  const utils = trpc.useUtils();

  // ── Notifications list (lazy) ─────────────────────────────────────────────
  const { data: notifData, isLoading: notifLoading } =
    trpc.v1.public.notification.list.useQuery(
      { limit: PREVIEW_LIMIT },
      { enabled: open && activeTab === "notifications", staleTime: 15_000 },
    );

  // ── Invitations list (lazy) ───────────────────────────────────────────────
  const { data: invitations, isLoading: invLoading } =
    trpc.v1.public.workspace.invitations.getMyPending.useQuery(undefined, {
      enabled: open && activeTab === "invitations",
      staleTime: 30_000,
    });

  const markReadMut = trpc.v1.public.notification.markRead.useMutation();
  const markAllReadMut = trpc.v1.public.notification.markAllRead.useMutation({
    onSuccess: () => {
      storeMarkAllRead();
      void utils.v1.public.notification.list.invalidate();
    },
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

  const notifications = notifData?.notifications ?? [];
  const invList = invitations ?? [];
  const invPreview = invList.slice(0, PREVIEW_LIMIT);
  const invHasMore = invList.length > PREVIEW_LIMIT;

  const showBadge = unreadCount > 0;

  function handleNotificationClick(n: {
    id: string;
    read: boolean;
    boardId: string | null;
    cardId: string | null;
  }) {
    if (!n.read) {
      markReadMut.mutate({ notificationId: n.id });
      storeMarkOneRead(n.id);
      void utils.v1.public.notification.list.invalidate();
    }
    setOpen(false);
    if (n.boardId && n.cardId) {
      router.push(`/board/${n.boardId}?card=${n.cardId}`);
    } else if (n.boardId) {
      router.push(`/board/${n.boardId}`);
    } else {
      router.push("/inbox");
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={showBadge ? `اعلان‌ها (${unreadCount} مورد)` : "اعلان‌ها"}
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
            {unreadCount > 9 ? "+۹" : unreadCount.toLocaleString("fa-IR")}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          dir="rtl"
          role="dialog"
          aria-label="اعلان‌ها"
          className="
            absolute end-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-md
            border border-slate-200 bg-white shadow-lg
          "
        >
          {/* Tabs */}
          <div className="flex border-b border-slate-100">
            <button
              type="button"
              onClick={() => setActiveTab("notifications")}
              className={`flex-1 px-3 py-2 text-sm font-medium ${
                activeTab === "notifications"
                  ? "border-b-2 border-blue-600 text-blue-700"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              اعلان‌ها
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("invitations")}
              className={`flex-1 px-3 py-2 text-sm font-medium ${
                activeTab === "invitations"
                  ? "border-b-2 border-blue-600 text-blue-700"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              دعوت‌ها
            </button>
          </div>

          {/* Notifications tab */}
          {activeTab === "notifications" && (
            <div>
              {notifLoading ? (
                <div className="space-y-2 p-3" aria-busy="true">
                  <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
                  <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
                  <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
                </div>
              ) : notifications.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-slate-500">
                  اعلانی ندارید.
                </p>
              ) : (
                <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                  {notifications.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => handleNotificationClick(n)}
                        className={`flex w-full items-start gap-2 px-3 py-2 text-right hover:bg-slate-50 ${
                          n.read ? "" : "bg-blue-50/50"
                        }`}
                      >
                        <UserAvatar displayName={n.actorName} size="xs" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-900" dir="auto">
                            {n.title}
                          </div>
                          {n.body ? (
                            <div className="truncate text-xs text-slate-500" dir="auto">
                              {n.body}
                            </div>
                          ) : null}
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            {formatRelative(n.createdAt)}
                          </div>
                        </div>
                        {!n.read && (
                          <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-blue-600" aria-hidden="true" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-center justify-between border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => markAllReadMut.mutate()}
                  disabled={markAllReadMut.isPending || unreadCount === 0}
                  className="px-3 py-2 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
                >
                  علامت‌گذاری همه به عنوان خوانده‌شده
                </button>
                <Link
                  href="/inbox"
                  onClick={() => setOpen(false)}
                  className="px-3 py-2 text-xs text-blue-600 hover:bg-blue-50"
                >
                  همه اعلان‌ها
                </Link>
              </div>
            </div>
          )}

          {/* Invitations tab */}
          {activeTab === "invitations" && (
            <div>
              {invLoading ? (
                <div className="space-y-2 p-3" aria-busy="true">
                  <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
                  <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
                </div>
              ) : invPreview.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-slate-500">
                  دعوت معلقی ندارید.
                </p>
              ) : (
                <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                  {invPreview.map((inv) => (
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

              {(invHasMore || invPreview.length > 0) && (
                <div className="border-t border-slate-100">
                  <Link
                    href="/invitations"
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2 text-center text-sm text-blue-600 hover:bg-blue-50"
                  >
                    {invHasMore
                      ? `همه دعوت‌ها (${invList.length.toLocaleString("fa-IR")})`
                      : "همه دعوت‌ها"}
                  </Link>
                </div>
              )}
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
