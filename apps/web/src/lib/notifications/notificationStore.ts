// apps/web/src/lib/notifications/notificationStore.ts
//
// Phase 1.2 (F1.2.9) — client-side notification store.
//
// Lives in `src/lib` (shared) — NOT inside a feature — because two
// features consume it: the `shell` feature (NotificationsBell badge) and
// the `board` feature (boardSocketClient pushes live NOTIFICATION messages
// into it). Cross-feature imports are blocked by the boundaries linter, so
// the only legal shared home is here.
//
// Holds just the bell's at-a-glance state:
//   • unreadCount         — drives the red badge.
//   • latestNotifications — a short, newest-first preview list that the
//                           bell can render instantly when a live push
//                           arrives, before any refetch.
//
// The authoritative list still comes from the tRPC query
// (v1.public.notification.list); this store is the real-time overlay.

import { create } from "zustand";

export interface NotificationStoreItem {
  id:        string;
  type:      string;
  title:     string;
  body:      string | null;
  cardId:    string | null;
  boardId:   string | null;
  read:      boolean;
  createdAt: string;
}

const MAX_PREVIEW = 20;

interface NotificationStoreState {
  unreadCount:         number;
  latestNotifications: NotificationStoreItem[];

  /** Replace the unread count (e.g. seeded from sidebar.bootstrap or a list refetch). */
  setUnreadCount: (n: number) => void;
  /** Bump the unread count by one (live push arrived). */
  incrementUnread: () => void;
  /** Prepend a freshly-received notification to the preview list. */
  prependNotification: (n: NotificationStoreItem) => void;
  /** Mark everything read (badge → 0, preview items flagged read). */
  markAllRead: () => void;
  /** Mark a single preview item read and decrement the count. */
  markOneRead: (id: string) => void;
}

export const useNotificationStore = create<NotificationStoreState>((set) => ({
  unreadCount:         0,
  latestNotifications: [],

  setUnreadCount: (n) => set({ unreadCount: Math.max(0, n) }),

  incrementUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),

  prependNotification: (n) =>
    set((s) => {
      // De-dupe by id in case a push and a refetch race.
      if (s.latestNotifications.some((x) => x.id === n.id)) return s;
      return {
        latestNotifications: [n, ...s.latestNotifications].slice(0, MAX_PREVIEW),
      };
    }),

  markAllRead: () =>
    set((s) => ({
      unreadCount: 0,
      latestNotifications: s.latestNotifications.map((x) => ({ ...x, read: true })),
    })),

  markOneRead: (id) =>
    set((s) => {
      const wasUnread = s.latestNotifications.find((x) => x.id === id && !x.read);
      return {
        unreadCount: wasUnread ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
        latestNotifications: s.latestNotifications.map((x) =>
          x.id === id ? { ...x, read: true } : x,
        ),
      };
    }),
}));
