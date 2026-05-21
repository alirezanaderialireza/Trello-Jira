"use client";

// apps/web/src/features/board/hooks/useBoardPresence.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Thin convenience wrapper around `usePresenceSync` that pulls the current
// userId out of the Auth.js session, so consumers (BoardView) only have to
// pass `boardId`.
//
// Why this hook exists rather than inlining the call:
//   1. It centralises the "who am I" lookup. If we later switch to a server-
//      injected userId prop or a context provider, only this hook changes.
//   2. It returns the resolved userId, which the new <PresenceAvatars />
//      component needs to filter the local user out of the avatar bar.
//   3. It guards against running the heartbeat loop before the session has
//      hydrated — `usePresenceSync` is a no-op when called with empty
//      strings, but we keep the contract explicit.
// ─────────────────────────────────────────────────────────────────────────────

import { useSession } from "next-auth/react";
import { usePresenceSync } from "./usePresenceSync";

export interface UseBoardPresenceResult {
  /** Resolved userId, or null while the session is loading. */
  userId: string | null;
  /** True once we have both a userId and a boardId; the heartbeat is running. */
  active: boolean;
}

export function useBoardPresence(boardId: string): UseBoardPresenceResult {
  const { data: session, status } = useSession();
  const userId =
    status === "authenticated" && session?.user?.id ? session.user.id : null;

  // `usePresenceSync` always runs (it's a hook — can't conditionally call
  // it) but its setup is idempotent and a falsy userId or boardId yields a
  // no-op heartbeat. The hook also tolerates SSR (returns early when
  // `window` is undefined).
  usePresenceSync({
    boardId: boardId || "",
    userId: userId ?? "",
  });

  return {
    userId,
    active: Boolean(userId && boardId),
  };
}
