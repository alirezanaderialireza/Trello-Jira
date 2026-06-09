"use client";

// apps/web/src/features/shell/hooks/useNotificationSocket.ts
//
// Phase 1.2 (F1.2.9) — seeds the shared notification store with the unread
// count from sidebar.bootstrap so the bell badge is accurate on first paint,
// app-wide, without an extra round-trip.
//
// Live updates: when the user is viewing a board, the board WebSocket
// connection (boardSocketClient) receives `NOTIFICATION` pushes from the
// ws-server and writes them into the same store, so the badge updates in
// real time. On non-board pages the badge reflects the seeded count and the
// figure the bell refetches when opened.
//
// The hook seeds only once (on mount / when the initial value first becomes
// available) so live increments from the socket are never clobbered by a
// re-render carrying the stale bootstrap number.

import { useEffect, useRef } from "react";

import { useNotificationStore } from "@/lib/notifications/notificationStore";

export function useNotificationSocket(initialUnreadCount: number): number {
  const seeded = useRef(false);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setUnreadCount(initialUnreadCount);
  }, [initialUnreadCount, setUnreadCount]);

  return unreadCount;
}
