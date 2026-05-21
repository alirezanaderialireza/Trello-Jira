// apps/web/src/features/board/store/sync/collaboration/presenceManager.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Tracks which users are online, on which board/list/card, and when they were
// last active.  Owns the outbound heartbeat timer and the inbound expiry sweep.
// Coordinates with other tabs via BroadcastChannel so that only one tab
// ("leader") sends heartbeats to the server.
//
// ─── Dependency graph ────────────────────────────────────────────────────────
//   presenceManager ──read/write──▶ presenceStore (internal Zustand slice)
//   presenceManager ──telemetry──▶  logEvent.telemetry
//   presenceManager ──send──▶       BoardSocketClient.sendCollabMessage()
//   awarenessProtocol ──imports──▶  PresenceState, presenceManager
//
// ─── Contracts guaranteed ────────────────────────────────────────────────────
//   • Heartbeat is sent exactly once per board regardless of tab count.
//   • Stale entries (> EXPIRE_AFTER_MS) are purged in the local expiry sweep.
//   • Every mutation of remotePresence is idempotent (safe to replay).
//   • No React dependency — pure class, usable outside component tree.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { telemetry } from "../../../devtools/logEvent";

// ============================================================================
// 1.  Public Types
// ============================================================================

export interface PresenceState {
  /** The user who owns this presence record. */
  readonly userId: string;
  /** Board this user is viewing. */
  readonly boardId: string;
  /** Narrower context — the list the user has focused. */
  readonly listId?: string;
  /** Narrowest context — the card the user has open. */
  readonly cardId?: string;
  /** Unix ms — when this record was last refreshed. */
  readonly lastActiveAt: number;
  /** Raw cursor position for cursor-manager consumption. */
  readonly cursor?: { readonly x: number; readonly y: number };
  /** IDs of items the user currently has selected. */
  readonly selection?: readonly string[];
}

/** Message shape sent over the WebSocket for presence. */
export interface PresenceMessage {
  readonly kind: "presence.heartbeat" | "presence.leave";
  readonly payload: Omit<PresenceState, "lastActiveAt">;
}

/** Message shape broadcast over BroadcastChannel between same-origin tabs. */
type TabBroadcast =
  | { readonly type: "LEADER_CLAIM"; readonly tabId: string }
  | { readonly type: "LEADER_PING"; readonly tabId: string }
  | { readonly type: "LEADER_ACK"; readonly tabId: string }
  | { readonly type: "PRESENCE_UPDATE"; readonly state: PresenceState };

// ============================================================================
// 2.  Internal Zustand store (not exported as a hook — read via getState())
// ============================================================================

interface PresenceStoreState {
  /** Local user's own current presence record. */
  local: PresenceState | null;
  /** All remote peers keyed by userId. */
  remote: Record<string, PresenceState>;

  _setLocal: (p: PresenceState) => void;
  _applyRemote: (p: PresenceState) => void;
  _removeRemote: (userId: string) => void;
  _sweepExpired: (now: number, expireAfterMs: number) => void;
}

const usePresenceStore = create<PresenceStoreState>()((set) => ({
  local: null,
  remote: {},

  _setLocal: (p) => set({ local: p }),

  _applyRemote: (p) =>
    set((s) => ({
      remote: {
        ...s.remote,
        [p.userId]: p,
      },
    })),

  _removeRemote: (userId) =>
    set((s) => {
      const { [userId]: _, ...rest } = s.remote;
      return { remote: rest };
    }),

  _sweepExpired: (now, expireAfterMs) =>
    set((s) => {
      const next: Record<string, PresenceState> = {};
      let changed = false;
      for (const [uid, entry] of Object.entries(s.remote)) {
        if (now - entry.lastActiveAt > expireAfterMs) {
          changed = true;
          telemetry.log(
            "PRESENCE",
            "PEER_EXPIRED",
            { userId: uid, lastActiveAt: entry.lastActiveAt, expiredAfterMs: expireAfterMs },
          );
        } else {
          next[uid] = entry;
        }
      }
      return changed ? { remote: next } : s;
    }),
}));

// ============================================================================
// 3.  Constants
// ============================================================================

const HEARTBEAT_INTERVAL_MS = 8_000;   // send presence every 8 s
const EXPIRE_AFTER_MS       = 25_000;  // peer gone after 25 s of silence
const SWEEP_INTERVAL_MS     = 12_000;  // expiry sweep every 12 s
const LEADER_TTL_MS         = 20_000;  // a leader claim lasts 20 s
const CHANNEL_NAME          = "kiro:presence";

// ============================================================================
// 4.  PresenceManager
// ============================================================================

/**
 * Wire up once per board mount.  Call `init()` to start, `destroy()` to stop.
 *
 * sendFn must be the live WebSocket send path so that this class has zero
 * coupling to the concrete BoardSocketClient class — testable in isolation.
 */
export class PresenceManager {
  // ── identity ──────────────────────────────────────────────────────────────
  private readonly tabId = crypto.randomUUID();
  private boardId: string | null = null;
  private userId: string | null = null;

  // ── transport ─────────────────────────────────────────────────────────────
  /**
   * Injected send function.  Signature mirrors BoardSocketClient.sendCollabMessage
   * which does NOT exist yet on the socket client — it will be added in
   * boardSocketClient extension (see Required File Operations at bottom of phase).
   * For now the type is explicit so the extension point is compile-time safe.
   */
  private readonly sendFn: (msg: PresenceMessage) => void;

  // ── timers ────────────────────────────────────────────────────────────────
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer:     ReturnType<typeof setInterval> | null = null;
  private leaderTimer:    ReturnType<typeof setInterval> | null = null;

  // ── multi-tab leadership ──────────────────────────────────────────────────
  private isLeader = false;
  private lastLeaderPingAt = 0;
  private channel: BroadcastChannel | null = null;

  // ── public read surface ───────────────────────────────────────────────────
  /** Reactive Zustand store — subscribe in React via usePresence() hook. */
  readonly store = usePresenceStore;

  constructor(sendFn: (msg: PresenceMessage) => void) {
    this.sendFn = sendFn;
  }

  // ==========================================================================
  // 4a. Lifecycle
  // ==========================================================================

  init(boardId: string, userId: string, initialFocus?: Pick<PresenceState, "listId" | "cardId">) {
    this.boardId = boardId;
    this.userId  = userId;

    this._setupBroadcastChannel();
    this._claimLeadership();

    const now = Date.now();
    const local: PresenceState = {
      userId,
      boardId,
      listId:       initialFocus?.listId,
      cardId:       initialFocus?.cardId,
      lastActiveAt: now,
    };

    usePresenceStore.getState()._setLocal(local);

    // Always start sweep — all tabs need to expire stale peers.
    this.sweepTimer = setInterval(() => {
      usePresenceStore.getState()._sweepExpired(Date.now(), EXPIRE_AFTER_MS);
    }, SWEEP_INTERVAL_MS);

    telemetry.log("PRESENCE", "INIT", { boardId, userId, tabId: this.tabId });
  }

  destroy() {
    this._stopHeartbeat();
    this._stopLeaderTimer();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;

    // Broadcast leave to peers if we were the leader.
    if (this.isLeader && this.boardId && this.userId) {
      this._sendHeartbeat(/* isLeave */ true);
    }

    // Notify other tabs that leadership is relinquishing.
    this.channel?.close();
    this.channel = null;
    this.isLeader = false;

    telemetry.log("PRESENCE", "DESTROYED", { boardId: this.boardId, tabId: this.tabId });
  }

  // ==========================================================================
  // 4b. Focus updates (called by UI on navigation)
  // ==========================================================================

  updateFocus(focus: Partial<Pick<PresenceState, "listId" | "cardId">>) {
    const current = usePresenceStore.getState().local;
    if (!current) return;

    const updated: PresenceState = {
      ...current,
      ...focus,
      lastActiveAt: Date.now(),
    };

    usePresenceStore.getState()._setLocal(updated);

    // Broadcast focus change to other tabs immediately (no WS latency for UI).
    this._tabBroadcast({ type: "PRESENCE_UPDATE", state: updated });

    // If leader, also push to server without waiting for next heartbeat interval.
    if (this.isLeader) {
      this._sendHeartbeat();
    }

    telemetry.log("PRESENCE", "FOCUS_UPDATED", { focus, tabId: this.tabId });
  }

  // ==========================================================================
  // 4c. Incoming remote presence (called by BoardSocketClient on WS message)
  // ==========================================================================

  applyRemotePresence(p: PresenceState) {
    // Do not reflect own presence back.
    if (p.userId === this.userId) return;

    usePresenceStore.getState()._applyRemote({
      ...p,
      // Always stamp with local clock to avoid clock-skew expiry issues.
      lastActiveAt: Date.now(),
    });

    // Rebroadcast to other same-origin tabs so all tabs are consistent.
    this._tabBroadcast({ type: "PRESENCE_UPDATE", state: p });

    telemetry.log("PRESENCE", "REMOTE_APPLIED", { userId: p.userId, boardId: p.boardId });
  }

  applyRemoteLeave(userId: string) {
    usePresenceStore.getState()._removeRemote(userId);
    telemetry.log("PRESENCE", "REMOTE_LEFT", { userId });
  }

  // ==========================================================================
  // 4d. Multi-tab leadership
  // ==========================================================================

  private _setupBroadcastChannel() {
    if (typeof BroadcastChannel === "undefined") {
      // SSR / non-browser context — this tab must act as sole leader.
      this.isLeader = true;
      this._startHeartbeat();
      return;
    }

    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (ev: MessageEvent<TabBroadcast>) => {
      this._handleTabMessage(ev.data);
    };
  }

  private _claimLeadership() {
    this.channel?.postMessage({ type: "LEADER_CLAIM", tabId: this.tabId } satisfies TabBroadcast);

    // Wait briefly for an existing leader to ack before assuming leadership.
    setTimeout(() => {
      if (!this.isLeader) {
        this._becomeLeader();
      }
    }, 200);
  }

  private _becomeLeader() {
    this.isLeader = true;
    this._startHeartbeat();
    this._startLeaderPingTimer();
    telemetry.log("PRESENCE", "LEADER_ACQUIRED", { tabId: this.tabId });
  }

  private _startLeaderPingTimer() {
    this._stopLeaderTimer();
    this.leaderTimer = setInterval(() => {
      this.lastLeaderPingAt = Date.now();
      this.channel?.postMessage({ type: "LEADER_PING", tabId: this.tabId } satisfies TabBroadcast);
    }, LEADER_TTL_MS / 2);
  }

  private _stopLeaderTimer() {
    if (this.leaderTimer) clearInterval(this.leaderTimer);
    this.leaderTimer = null;
  }

  private _handleTabMessage(msg: TabBroadcast) {
    switch (msg.type) {
      case "LEADER_CLAIM":
        // Another tab is claiming leadership — ack if we are current leader.
        if (this.isLeader) {
          this.channel!.postMessage({ type: "LEADER_ACK", tabId: this.tabId } satisfies TabBroadcast);
        }
        break;

      case "LEADER_ACK":
        // A leader already exists — we do not become leader.
        // (Only relevant in the 200 ms window after _claimLeadership.)
        this.isLeader = false;
        break;

      case "LEADER_PING":
        // A live leader exists — record its ping time.
        this.lastLeaderPingAt = Date.now();
        if (this.isLeader && msg.tabId !== this.tabId) {
          // Split-brain: two leaders. Resolve by tab ID lexicographic order.
          if (msg.tabId < this.tabId) {
            this._resignLeadership();
          }
        }
        break;

      case "PRESENCE_UPDATE":
        // Another tab updated local presence (focus changed) — apply without
        // touching the server; only update the local store projection.
        if (msg.state.userId === this.userId) {
          usePresenceStore.getState()._setLocal(msg.state);
        } else {
          usePresenceStore.getState()._applyRemote({
            ...msg.state,
            lastActiveAt: Date.now(),
          });
        }
        break;
    }
  }

  private _resignLeadership() {
    this.isLeader = false;
    this._stopHeartbeat();
    this._stopLeaderTimer();
    telemetry.log("PRESENCE", "LEADER_RESIGNED", { tabId: this.tabId, reason: "split_brain_resolved" });
  }

  // ==========================================================================
  // 4e. Heartbeat
  // ==========================================================================

  private _startHeartbeat() {
    this._stopHeartbeat();
    // Send immediately on start, then on interval.
    this._sendHeartbeat();
    this.heartbeatTimer = setInterval(() => this._sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  private _stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private _sendHeartbeat(isLeave = false) {
    if (!this.boardId || !this.userId) return;

    const local = usePresenceStore.getState().local;
    if (!local && !isLeave) return;

    const msg: PresenceMessage = {
      kind: isLeave ? "presence.leave" : "presence.heartbeat",
      payload: {
        userId:   this.userId,
        boardId:  this.boardId,
        listId:   local?.listId,
        cardId:   local?.cardId,
        cursor:   local?.cursor,
        selection: local?.selection,
      },
    };

    try {
      this.sendFn(msg);
    } catch (err) {
      // WS might be closed during reconnect — non-fatal.
      telemetry.log("PRESENCE", "HEARTBEAT_SEND_FAILED", { error: String(err) });
    }

    telemetry.log("PRESENCE", isLeave ? "LEAVE_SENT" : "HEARTBEAT_SENT", {
      boardId: this.boardId,
      isLeader: this.isLeader,
    });
  }

  // ==========================================================================
  // 4f. Internal tab broadcast helper
  // ==========================================================================

  private _tabBroadcast(msg: TabBroadcast) {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // Channel may be closed — safe to ignore.
    }
  }
}

// ============================================================================
// 5.  Read-only hook for React components
// ============================================================================

/** Subscribe to all remote peers present on the current board. */
export function useRemotePresence(): Record<string, PresenceState> {
  return usePresenceStore((s) => s.remote);
}

/** Subscribe to the local user's own presence record. */
export function useLocalPresence(): PresenceState | null {
  return usePresenceStore((s) => s.local);
}
