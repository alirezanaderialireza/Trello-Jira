// apps/web/src/features/board/store/sync/collaboration/awarenessProtocol.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Owns the complete AwarenessVector per user and provides the single
// consolidated state surface that UI components read from.
//
// This is the top-level orchestrator for the collaboration layer.  It:
//   1. Holds one AwarenessVector per user (local + all peers).
//   2. Merges partial updates from presenceManager, typingManager,
//      cursorManager and selectionManager into a unified vector.
//   3. Broadcasts the merged local vector over WS on any sub-system change.
//   4. Applies inbound peer vectors (from WS) into the store idempotently,
//      using per-field timestamp comparison (last-write-wins per field).
//   5. Handles join / leave / reconnect lifecycle:
//        • join    → emit own vector to server
//        • leave   → zero-out own vector, send tombstone
//        • reconnect → re-emit own vector so peers catch up
//   6. Runs a heartbeat that re-broadcasts own vector when nothing else has
//      changed — keeps peers alive in their expiry windows.
//   7. Sweeps stale peer vectors after PEER_EXPIRE_MS.
//
// ─── Merge semantics ─────────────────────────────────────────────────────────
// Each field in AwarenessVector carries its own `timestamp` so that concurrent
// updates from different sub-systems (e.g. cursor moved at T=100, typing
// stopped at T=90) are merged correctly without either clobbering the other.
//
// mergeVector(local, incoming):
//   for each field: keep the value with the higher timestamp.
//
// This is safe because:
//   • Each field is set by exactly one sub-system (no cross-field writes).
//   • Clock skew is bounded within a session — all updates carry local-clock ms.
//   • The server is the broadcast relay only; it does not modify vectors.
//
// ─── Dependency graph ────────────────────────────────────────────────────────
//   awarenessProtocol
//     ← presenceManager  (read local presence to build vector)
//     ← typingManager    (read localIsTyping / localContext)
//     ← cursorManager    (read local cursor entry)
//     ← selectionManager (read local selection)
//     → WS sendFn        (broadcast merged vector)
//     → useAwarenessStore (reactive state for React)
//
// ─── What awarenessProtocol does NOT own ────────────────────────────────────
//   • It does not drive heartbeats for the sub-systems — each manager owns its
//     own timers.  The protocol's heartbeat only re-broadcasts the awareness
//     vector itself.
//   • It does not apply domain events to BoardStoreState — that stays in
//     reconcileIncomingEvent.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { telemetry } from "@/lib/telemetry/logEvent";
import type { PresenceManager, PresenceState } from "./presenceManager";
import type { TypingManager, TypingContext } from "./typingManager";
import type { CursorManager, CursorPosition } from "./cursorManager";
import type { SelectionManager, SelectionItem } from "./selectionManager";

// ============================================================================
// 1.  AwarenessVector — canonical per-user state
// ============================================================================

/**
 * A stamped field: value + the local-clock ms when it was last written.
 * Used for per-field last-write-wins merge.
 */
export interface Stamped<T> {
  readonly value:     T;
  readonly timestamp: number;
}

export interface AwarenessVector {
  readonly userId:   string;
  readonly boardId:  string;

  /** Presence sub-state (focus + lastActiveAt). */
  readonly presence: Stamped<{
    readonly listId?:       string;
    readonly cardId?:       string;
    readonly lastActiveAt:  number;
  } | null>;

  /** Cursor position, or null when cursor is not on the board. */
  readonly cursor: Stamped<CursorPosition | null>;

  /** Active typing context, or null when not typing. */
  readonly typing: Stamped<{
    readonly context: TypingContext;
  } | null>;

  /** Currently selected items. */
  readonly selection: Stamped<readonly SelectionItem[]>;

  /**
   * Monotonic counter for the whole vector.
   * Incremented every time any field changes.
   * Used by the server to detect gaps (same semantics as boardSequence).
   */
  readonly vectorClock: number;
}

/** Partial inbound vector — peers may omit fields they haven't changed. */
export type PartialAwarenessVector = Pick<AwarenessVector, "userId" | "boardId" | "vectorClock"> &
  Partial<Omit<AwarenessVector, "userId" | "boardId" | "vectorClock">>;

/** Message sent over WS. */
export interface AwarenessMessage {
  readonly kind: "awareness.update" | "awareness.leave";
  readonly payload: PartialAwarenessVector;
}

// ============================================================================
// 2.  Internal Zustand store
// ============================================================================

interface AwarenessStoreState {
  /** Local user's own full vector — source of truth for outbound messages. */
  local: AwarenessVector | null;
  /** All peer vectors keyed by userId. */
  peers: Record<string, AwarenessVector>;

  _setLocal:     (v: AwarenessVector | null) => void;
  _mergePeer:    (incoming: PartialAwarenessVector) => void;
  _removePeer:   (userId: string) => void;
  _sweepExpired: (now: number, expireAfterMs: number) => void;
}

/** Per-field last-write-wins merge of two full vectors. */
function mergeVectors(
  existing: AwarenessVector,
  incoming: PartialAwarenessVector,
): AwarenessVector {
  const presence  = pickNewer(existing.presence,  incoming.presence);
  const cursor    = pickNewer(existing.cursor,     incoming.cursor);
  const typing    = pickNewer(existing.typing,     incoming.typing);
  const selection = pickNewer(existing.selection,  incoming.selection);

  return {
    ...existing,
    presence,
    cursor,
    typing,
    selection,
    // Advance vectorClock to the higher of the two.
    vectorClock: Math.max(existing.vectorClock, incoming.vectorClock),
  };
}

function pickNewer<T>(
  a: Stamped<T> | undefined,
  b: Stamped<T> | undefined,
): Stamped<T> {
  if (!a && !b) return { value: undefined as unknown as T, timestamp: 0 };
  if (!a) return b!;
  if (!b) return a;
  return b.timestamp >= a.timestamp ? b : a;
}

const useAwarenessStore = create<AwarenessStoreState>()((set) => ({
  local: null,
  peers: {},

  _setLocal: (v) => set({ local: v }),

  _mergePeer: (incoming) =>
    set((s) => {
      const existing = s.peers[incoming.userId];

      if (!existing) {
        // First time we see this peer — bootstrap a full vector.
        const bootstrapped: AwarenessVector = {
          userId:      incoming.userId,
          boardId:     incoming.boardId,
          presence:    incoming.presence  ?? { value: null, timestamp: 0 },
          cursor:      incoming.cursor    ?? { value: null, timestamp: 0 },
          typing:      incoming.typing    ?? { value: null, timestamp: 0 },
          selection:   incoming.selection ?? { value: [],   timestamp: 0 },
          vectorClock: incoming.vectorClock,
        };
        return { peers: { ...s.peers, [incoming.userId]: bootstrapped } };
      }

      // Already known — merge field-by-field.
      const merged = mergeVectors(existing, incoming);
      return { peers: { ...s.peers, [incoming.userId]: merged } };
    }),

  _removePeer: (userId) =>
    set((s) => {
      const { [userId]: _, ...rest } = s.peers;
      return { peers: rest };
    }),

  _sweepExpired: (now, expireAfterMs) =>
    set((s) => {
      const next: Record<string, AwarenessVector> = {};
      let changed = false;

      for (const [uid, vec] of Object.entries(s.peers)) {
        const lastActive = vec.presence?.value?.lastActiveAt ?? 0;
        const lastCursor = vec.cursor?.timestamp ?? 0;
        const lastSeen   = Math.max(lastActive, lastCursor, vec.typing?.timestamp ?? 0);

        if (now - lastSeen > expireAfterMs) {
          changed = true;
          telemetry.log("AWARENESS", "PEER_VECTOR_EXPIRED", {
            userId: uid, lastSeen, expiredAfterMs: expireAfterMs,
          });
        } else {
          next[uid] = vec;
        }
      }
      return changed ? { peers: next } : s;
    }),
}));

// ============================================================================
// 3.  Constants
// ============================================================================

const HEARTBEAT_INTERVAL_MS = 10_000;   // re-broadcast own vector every 10 s
const PEER_EXPIRE_MS        = 35_000;   // peer gone after 35 s of silence
const SWEEP_INTERVAL_MS     = 15_000;   // expiry sweep every 15 s
const CHANNEL_NAME          = "kiro:awareness";

// ============================================================================
// 4.  AwarenessProtocol
// ============================================================================

export class AwarenessProtocol {
  // ── identity ──────────────────────────────────────────────────────────────
  private userId:  string | null = null;
  private boardId: string | null = null;

  // ── sub-system references ─────────────────────────────────────────────────
  private presence:  PresenceManager  | null = null;
  private typing:    TypingManager    | null = null;
  private cursor:    CursorManager    | null = null;
  private selection: SelectionManager | null = null;

  // ── transport ─────────────────────────────────────────────────────────────
  private readonly sendFn: (msg: AwarenessMessage) => void;

  // ── vector state ──────────────────────────────────────────────────────────
  private vectorClock = 0;

  // ── timers ────────────────────────────────────────────────────────────────
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer:     ReturnType<typeof setInterval> | null = null;

  // ── multi-tab ─────────────────────────────────────────────────────────────
  private readonly tabId = crypto.randomUUID();
  private channel: BroadcastChannel | null = null;

  // ── public store ──────────────────────────────────────────────────────────
  readonly store = useAwarenessStore;

  constructor(sendFn: (msg: AwarenessMessage) => void) {
    this.sendFn = sendFn;
  }

  // ==========================================================================
  // 4a. Lifecycle
  // ==========================================================================

  init(
    boardId: string,
    userId: string,
    managers: {
      presence:  PresenceManager;
      typing:    TypingManager;
      cursor:    CursorManager;
      selection: SelectionManager;
    },
  ) {
    this.boardId   = boardId;
    this.userId    = userId;
    this.presence  = managers.presence;
    this.typing    = managers.typing;
    this.cursor    = managers.cursor;
    this.selection = managers.selection;

    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (
        ev: MessageEvent<AwarenessMessage & { _tabId?: string }>,
      ) => {
        this._handleTabMessage(ev.data);
      };
    }

    // Emit own vector immediately on join.
    this._buildAndBroadcast("join");

    this.heartbeatTimer = setInterval(() => {
      this._buildAndBroadcast("heartbeat");
    }, HEARTBEAT_INTERVAL_MS);

    this.sweepTimer = setInterval(() => {
      useAwarenessStore.getState()._sweepExpired(Date.now(), PEER_EXPIRE_MS);
    }, SWEEP_INTERVAL_MS);

    telemetry.log("AWARENESS", "INIT", { boardId, userId, tabId: this.tabId });
  }

  /**
   * Must be called when the user's view of any sub-system changes.
   * Collects the latest state from all managers, builds a new vector,
   * and broadcasts it.
   *
   * Called by:
   *   • presenceManager.updateFocus()  → pass "presence_changed"
   *   • typingManager  (start/stop)    → pass "typing_changed"
   *   • cursorManager  (move)          → pass "cursor_changed"
   *   • selectionManager (select)      → pass "selection_changed"
   */
  notify(reason: string) {
    this._buildAndBroadcast(reason);
  }

  /**
   * Call on WS reconnect.  Re-emits own vector so all peers catch up,
   * and triggers a peer-list refresh request.
   */
  onReconnect() {
    telemetry.log("AWARENESS", "RECONNECT_SYNC", { userId: this.userId });
    this._buildAndBroadcast("reconnect");
  }

  destroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.sweepTimer)     clearInterval(this.sweepTimer);
    this.heartbeatTimer = null;
    this.sweepTimer     = null;

    // Broadcast leave tombstone.
    if (this.userId && this.boardId) {
      const tombstone: AwarenessMessage = {
        kind: "awareness.leave",
        payload: {
          userId:      this.userId,
          boardId:     this.boardId,
          vectorClock: ++this.vectorClock,
        },
      };
      try { this.sendFn(tombstone); } catch { /* WS may be closing */ }
      this._tabBroadcast({ ...tombstone, _tabId: this.tabId });
    }

    useAwarenessStore.getState()._setLocal(null);
    this.channel?.close();
    this.channel = null;

    telemetry.log("AWARENESS", "DESTROYED", { boardId: this.boardId });
  }

  // ==========================================================================
  // 4b. Inbound peer vectors (called by BoardSocketClient on WS message)
  // ==========================================================================

  applyRemoteVector(msg: AwarenessMessage) {
    if (!this.userId) return;

    if (msg.kind === "awareness.leave") {
      useAwarenessStore.getState()._removePeer(msg.payload.userId);
      telemetry.log("AWARENESS", "PEER_LEFT", { userId: msg.payload.userId });
      return;
    }

    if (msg.payload.userId === this.userId) return; // never echo own

    useAwarenessStore.getState()._mergePeer(msg.payload);

    // Also push updates down into individual managers so their own stores
    // stay consistent (presence remote, cursor remote, etc.).
    this._fanOutToManagers(msg.payload);

    // Forward to other same-origin tabs.
    this._tabBroadcast({ ...msg, _tabId: this.tabId });

    telemetry.log("AWARENESS", "PEER_VECTOR_MERGED", {
      userId:      msg.payload.userId,
      vectorClock: msg.payload.vectorClock,
    });
  }

  // ==========================================================================
  // 4c. Internal — build local vector from sub-systems
  // ==========================================================================

  private _buildAndBroadcast(reason: string) {
    if (!this.userId || !this.boardId) return;

    const now    = Date.now();
    const vector = this._buildLocalVector(now);

    useAwarenessStore.getState()._setLocal(vector);

    const msg: AwarenessMessage = {
      kind:    "awareness.update",
      payload: vector,
    };

    try {
      this.sendFn(msg);
    } catch (err) {
      telemetry.log("AWARENESS", "SEND_FAILED", { reason, error: String(err) });
    }

    this._tabBroadcast({ ...msg, _tabId: this.tabId });

    telemetry.log("AWARENESS", "BROADCAST", {
      reason,
      vectorClock: vector.vectorClock,
      userId:      this.userId,
    });
  }

  private _buildLocalVector(now: number): AwarenessVector {
    this.vectorClock += 1;

    // ── Presence ────────────────────────────────────────────────────────────
    const localPresence = this.presence?.store.getState().local;
    const presenceStamped: Stamped<AwarenessVector["presence"]["value"]> = {
      value: localPresence
        ? {
            listId:       localPresence.listId,
            cardId:       localPresence.cardId,
            lastActiveAt: localPresence.lastActiveAt,
          }
        : null,
      timestamp: localPresence?.lastActiveAt ?? now,
    };

    // ── Cursor ───────────────────────────────────────────────────────────────
    const localCursor = this.cursor?.store.getState().local;
    const cursorStamped: Stamped<CursorPosition | null> = {
      value:     localCursor?.position ?? null,
      timestamp: localCursor?.updatedAt ?? now,
    };

    // ── Typing ───────────────────────────────────────────────────────────────
    const typingState    = this.typing?.store.getState();
    const localTypingCtx = typingState?.localIsTyping ? typingState.localContext : null;
    const typingStamped: Stamped<{ context: TypingContext } | null> = {
      value:     localTypingCtx ? { context: localTypingCtx } : null,
      timestamp: now,
    };

    // ── Selection ────────────────────────────────────────────────────────────
    const localSelection = this.selection?.store.getState().local;
    const selectionStamped: Stamped<readonly SelectionItem[]> = {
      value:     localSelection?.items ?? [],
      timestamp: localSelection?.updatedAt ?? now,
    };

    return {
      userId:      this.userId!,
      boardId:     this.boardId!,
      presence:    presenceStamped,
      cursor:      cursorStamped,
      typing:      typingStamped,
      selection:   selectionStamped,
      vectorClock: this.vectorClock,
    };
  }

  // ==========================================================================
  // 4d. Fan-out inbound vector into individual manager stores
  // ==========================================================================

  private _fanOutToManagers(v: PartialAwarenessVector) {
    // ── Presence ─────────────────────────────────────────────────────────────
    if (v.presence?.value && this.presence) {
      this.presence.applyRemotePresence({
        userId:       v.userId,
        boardId:      v.boardId,
        listId:       v.presence.value.listId,
        cardId:       v.presence.value.cardId,
        lastActiveAt: v.presence.value.lastActiveAt,
      });
    }

    // ── Cursor ───────────────────────────────────────────────────────────────
    if (v.cursor !== undefined && this.cursor) {
      if (v.cursor.value) {
        this.cursor.applyRemoteCursor({
          kind: "cursor.move",
          payload: {
            userId:   v.userId,
            boardId:  v.boardId,
            position: v.cursor.value,
            // Use vectorClock as seq for ordering within awareness messages.
            seq: v.vectorClock,
          },
        });
      } else {
        this.cursor.applyRemoteCursor({
          kind: "cursor.leave",
          payload: { userId: v.userId, boardId: v.boardId, seq: v.vectorClock },
        });
      }
    }

    // ── Typing ───────────────────────────────────────────────────────────────
    if (v.typing !== undefined && this.typing) {
      this.typing.applyRemoteTyping({
        kind: v.typing.value ? "typing.start" : "typing.stop",
        payload: {
          userId:  v.userId,
          boardId: v.boardId,
          context: v.typing.value?.context ?? { field: "title" },
        },
      });
    }

    // ── Selection ────────────────────────────────────────────────────────────
    if (v.selection !== undefined && this.selection) {
      this.selection.applyRemoteSelection({
        kind:    v.selection.value.length > 0 ? "selection.update" : "selection.clear",
        payload: {
          userId:  v.userId,
          boardId: v.boardId,
          items:   v.selection.value,
        },
      });
    }
  }

  // ==========================================================================
  // 4e. Multi-tab helpers
  // ==========================================================================

  private _handleTabMessage(msg: AwarenessMessage & { _tabId?: string }) {
    if (msg._tabId === this.tabId) return; // own echo
    this.applyRemoteVector(msg);
  }

  private _tabBroadcast(msg: AwarenessMessage & { _tabId?: string }) {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // Channel closed — safe to ignore.
    }
  }
}

// ============================================================================
// 5.  React hooks
// ============================================================================

/** The local user's own full AwarenessVector. */
export function useLocalAwareness(): AwarenessVector | null {
  return useAwarenessStore((s) => s.local);
}

/** All peer AwarenessVectors keyed by userId. */
export function usePeerAwareness(): Record<string, AwarenessVector> {
  return useAwarenessStore((s) => s.peers);
}

/** A single peer's AwarenessVector. Re-renders only when that peer changes. */
export function usePeerVector(userId: string): AwarenessVector | undefined {
  return useAwarenessStore((s) => s.peers[userId]);
}

/**
 * Returns the count of users currently active on the board.
 * "Active" = has a peer vector that has not expired.
 */
export function useActivePeerCount(): number {
  return useAwarenessStore((s) => Object.keys(s.peers).length);
}
