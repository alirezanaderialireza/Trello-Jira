"use client";

// apps/web/src/features/notifications/InboxPage.tsx
//
// Phase 1.2 (F1.2.9) — full Inbox view at /inbox. Paginated list of every
// notification for the current user, newest-first, with mark-as-read on click
// and a mark-all-read action. Unread rows carry a blue dot.

import { useRouter } from "next/navigation";

import { trpc } from "../../utils/trpc";
import { formatRelative } from "../../lib/relativeTime";
import { UserAvatar } from "../../components/users/UserAvatar";
import { useNotificationStore } from "../../lib/notifications/notificationStore";

const PAGE_SIZE = 20;

export function InboxPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const storeMarkAllRead = useNotificationStore((s) => s.markAllRead);
  const storeMarkOneRead = useNotificationStore((s) => s.markOneRead);

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = trpc.v1.public.notification.list.useInfiniteQuery(
    { limit: PAGE_SIZE },
    { getNextPageParam: (lastPage) => lastPage.nextCursor },
  );

  const markReadMut = trpc.v1.public.notification.markRead.useMutation();
  const markAllReadMut = trpc.v1.public.notification.markAllRead.useMutation({
    onSuccess: () => {
      storeMarkAllRead();
      void utils.v1.public.notification.list.invalidate();
    },
  });

  const notifications = data?.pages.flatMap((p) => p.notifications) ?? [];

  function handleClick(n: {
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
    if (n.boardId && n.cardId) {
      router.push(`/board/${n.boardId}?card=${n.cardId}`);
    } else if (n.boardId) {
      router.push(`/board/${n.boardId}`);
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">اعلان‌ها</h1>
        <button
          type="button"
          onClick={() => markAllReadMut.mutate()}
          disabled={markAllReadMut.isPending}
          className="rounded-md px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-50"
        >
          علامت‌گذاری همه به عنوان خوانده‌شده
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-500">
          هیچ اعلانی ندارید.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {notifications.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => handleClick(n)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-slate-50 ${
                  n.read ? "" : "bg-blue-50/50"
                }`}
              >
                <UserAvatar displayName={n.actorName} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900" dir="auto">
                    {n.title}
                  </div>
                  {n.body ? (
                    <div className="mt-0.5 truncate text-xs text-slate-500" dir="auto">
                      {n.body}
                    </div>
                  ) : null}
                  <div className="mt-1 text-[11px] text-slate-400">
                    {formatRelative(n.createdAt)}
                  </div>
                </div>
                {!n.read && (
                  <span
                    className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-blue-600"
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasNextPage && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {isFetchingNextPage ? "در حال بارگذاری…" : "بارگذاری بیشتر"}
          </button>
        </div>
      )}
    </div>
  );
}
