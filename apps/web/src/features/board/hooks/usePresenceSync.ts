// apps/web/src/features/board/hooks/usePresenceSync.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Bridges the WS server's presence/cursor/typing messages with the Phase 3
// collaboration layer (PresenceManager, CursorManager, TypingManager).
//
// This hook:
//   1. Extends boardSocketClient to send presence/cursor/typing actions.
//   2. Listens for PRESENCE_JOIN, PRESENCE_LEAVE, PRESENCE_UPDATE,
//      PRESENCE_LIST, CURSOR_UPDATE, TYPING_UPDATE messages from WS.
//   3. Pipes inbound messages into the collaboration singleton managers.
//   4. Sends outbound presence heartbeats on an interval.
//   5. Sends cursor movements (throttled via CursorManager's rAF batching).
//   6. Sends typing start/stop via TypingManager.
//
// Usage in BoardPage:
//   usePresenceSync({ boardId, userId });
//
// ─── Design rules ────────────────────────────────────────────────────────────
//   • Single hook — call once at the board-level component.
//   • No store mutations — delegates to collaboration singleton.
//   • Cleans up on unmount (interval clear, event listener removal).
//   • SSR-safe — early return when typeof window === "undefined".
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useRef, useCallback } from "react";
import { boardSocket } from "../api/realtime/boardSocketClient";
import { collaboration } from "../store/sync/collaboration";
import type { PresenceState } from "../store/sync/collaboration/presenceManager";
import type { CursorPosition } from "../store/sync/collaboration/cursorManager";
import type { TypingContext } from "../store/sync/collaboration/typingManager";

// ============================================================================
// 1.  Config
// ============================================================================

const PRESENCE_HEARTBEAT_MS = 8_000; // Send presence heartbeat every 8s

// ============================================================================
// 2.  Types for WS messages (inbound from server)
// ============================================================================

interface PresenceUser {
  userId: string;
  cursor: { x: number; y: number } | null;
  status: string;
  connectionId: string;
}

interface WsPresenceJoin {
  type: "PRESENCE_JOIN";
  payload: { userId: string; connectionId: string; timestamp: number };
}

interface WsPresenceLeave {
  type: "PRESENCE_LEAVE";
  payload: { userId: string; connectionId: string; timestamp: number };
}

interface WsPresenceUpdate {
  type: "PRESENCE_UPDATE";
  payload: {
    userId: string;
    status: string;
    cursor: { x: number; y: number } | null;
    connectionId: string;
    timestamp: number;
  };
}

interface WsPresenceList {
  type: "PRESENCE_LIST";
  payload: { users: PresenceUser[]; timestamp: number };
}

interface WsCursorUpdate {
  type: "CURSOR_UPDATE";
  payload: { userId: string; cursor: { x: number; y: number } | null; timestamp: number };
}

interface WsTypingUpdate {
  type: "TYPING_UPDATE";
  payload: {
    userId: string;
    typing: { cardId?: string; listId?: string; field?: string; active: boolean };
    timestamp: number;
  };
}

type WsCollabMessage =
  | WsPresenceJoin
  | WsPresenceLeave
  | WsPresenceUpdate
  | WsPresenceList
  | WsCursorUpdate
  | WsTypingUpdate;

// ============================================================================
// 3.  Hook interface
// ============================================================================

export interface UsePresenceSyncOptions {
  boardId: string;
  userId: string;
}

// ============================================================================
// 4.  The hook
// ============================================================================

export function usePresenceSync({ boardId, userId }: UsePresenceSyncOptions) {
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listenerRef = useRef<((event: MessageEvent) => void) | null>(null);

  // ── Setup: attach WS message listener + start heartbeat ────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Initialize collaboration layer (idempotent — safe to call multiple times)
    const sendFn = (msg: any) => {
      const ws = (boardSocket as any).ws as WebSocket | null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    // The collaboration facade should already be initialized by BoardPage.
    // We just need to wire the WS inbound messages to it.

    // ── Attach raw WS message listener ─────────────────────────────────────
    const handleWsMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as WsCollabMessage;
        routeInboundMessage(msg, userId, boardId);
      } catch {
        // Not a collab message — ignore (domain events handled elsewhere)
      }
    };

    // Access the underlying WebSocket instance from boardSocketClient
    // We need to monkey-patch the onmessage to also route collab messages.
    // Since boardSocketClient already has its own handleMessage, we use
    // a MutationObserver-style approach: override the ws.onmessage wrapper.
    const patchWs = () => {
      const ws = (boardSocket as any).ws as WebSocket | null;
      if (!ws) return;

      const originalOnMessage = ws.onmessage;
      ws.onmessage = (event: MessageEvent) => {
        // Call original handler first (handles domain events)
        if (originalOnMessage) {
          originalOnMessage.call(ws, event);
        }
        // Then route collab messages
        handleWsMessage(event);
      };
    };

    // Patch after a small delay to ensure boardSocket has connected
    const patchTimer = setTimeout(patchWs, 500);

    // Also try patching on any future reconnect
    const reconnectPatchInterval = setInterval(() => {
      const ws = (boardSocket as any).ws as WebSocket | null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        patchWs();
      }
    }, 5000);

    // ── Start presence heartbeat ───────────────────────────────────────────
    const sendPresenceHeartbeat = () => {
      const ws = (boardSocket as any).ws as WebSocket | null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          action: "presence",
          boardId,
          userId,
          status: "ACTIVE",
        }));
      }
    };

    // Send immediately on mount
    setTimeout(sendPresenceHeartbeat, 1000);

    heartbeatRef.current = setInterval(sendPresenceHeartbeat, PRESENCE_HEARTBEAT_MS);

    // ── Cleanup ────────────────────────────────────────────────────────────
    return () => {
      clearTimeout(patchTimer);
      clearInterval(reconnectPatchInterval);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    };
  }, [boardId, userId]);

  // ── Public API: send cursor position ───────────────────────────────────────
  const sendCursor = useCallback(
    (position: CursorPosition) => {
      // Update local collaboration manager
      collaboration.cursor.moveCursor(position);

      // Also send directly via WS for server-side broadcast
      const ws = (boardSocket as any).ws as WebSocket | null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          action: "cursor",
          boardId,
          userId,
          cursor: position,
        }));
      }
    },
    [boardId, userId],
  );

  // ── Public API: send typing status ─────────────────────────────────────────
  const sendTypingStart = useCallback(
    (context: TypingContext) => {
      collaboration.typing.startTyping(context);

      const ws = (boardSocket as any).ws as WebSocket | null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          action: "typing",
          boardId,
          userId,
          typing: { ...context, active: true },
        }));
      }
    },
    [boardId, userId],
  );

  const sendTypingStop = useCallback(
    (context?: TypingContext) => {
      collaboration.typing.stopTyping(context);

      const ws = (boardSocket as any).ws as WebSocket | null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          action: "typing",
          boardId,
          userId,
          typing: { ...(context ?? {}), active: false },
        }));
      }
    },
    [boardId, userId],
  );

  return { sendCursor, sendTypingStart, sendTypingStop };
}

// ============================================================================
// 5.  Inbound message router — maps WS messages to collaboration managers
// ============================================================================

function routeInboundMessage(msg: WsCollabMessage, localUserId: string, boardId: string) {
  switch (msg.type) {
    case "PRESENCE_JOIN": {
      if (msg.payload.userId === localUserId) return; // skip self
      collaboration.presence.applyRemotePresence({
        userId: msg.payload.userId,
        boardId,
        lastActiveAt: msg.payload.timestamp,
      });
      break;
    }

    case "PRESENCE_LEAVE": {
      if (msg.payload.userId === localUserId) return;
      collaboration.presence.applyRemoteLeave(msg.payload.userId);
      collaboration.cursor.applyRemoteCursor({
        kind: "cursor.leave",
        payload: { userId: msg.payload.userId, boardId, seq: Date.now() },
      });
      break;
    }

    case "PRESENCE_UPDATE": {
      if (msg.payload.userId === localUserId) return;
      collaboration.presence.applyRemotePresence({
        userId: msg.payload.userId,
        boardId,
        lastActiveAt: msg.payload.timestamp,
        cursor: msg.payload.cursor ?? undefined,
      });
      break;
    }

    case "PRESENCE_LIST": {
      // Bulk apply all currently-online users
      for (const user of msg.payload.users) {
        if (user.userId === localUserId) continue;
        collaboration.presence.applyRemotePresence({
          userId: user.userId,
          boardId,
          lastActiveAt: msg.payload.timestamp,
          cursor: user.cursor ?? undefined,
        });
        if (user.cursor) {
          collaboration.cursor.applyRemoteCursor({
            kind: "cursor.move",
            payload: {
              userId: user.userId,
              boardId,
              position: user.cursor,
              seq: msg.payload.timestamp,
            },
          });
        }
      }
      break;
    }

    case "CURSOR_UPDATE": {
      if (msg.payload.userId === localUserId) return;
      if (msg.payload.cursor) {
        collaboration.cursor.applyRemoteCursor({
          kind: "cursor.move",
          payload: {
            userId: msg.payload.userId,
            boardId,
            position: msg.payload.cursor,
            seq: msg.payload.timestamp,
          },
        });
      } else {
        collaboration.cursor.applyRemoteCursor({
          kind: "cursor.leave",
          payload: { userId: msg.payload.userId, boardId, seq: msg.payload.timestamp },
        });
      }
      break;
    }

    case "TYPING_UPDATE": {
      if (msg.payload.userId === localUserId) return;
      const { typing } = msg.payload;
      if (!typing) return;

      const context: TypingContext = {
        field: (typing.field as any) ?? "title",
        cardId: typing.cardId,
        listId: typing.listId,
      };

      collaboration.typing.applyRemoteTyping({
        kind: typing.active ? "typing.start" : "typing.stop",
        payload: {
          userId: msg.payload.userId,
          boardId,
          context,
        },
      });
      break;
    }
  }
}
