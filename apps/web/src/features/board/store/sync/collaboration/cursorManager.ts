// apps/web/src/features/board/store/sync/collaboration/cursorManager.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Tracks real-time cursor positions for all users on a board.
// Owns:
//   • Local cursor coalescing      → rAF-based batching, drop redundant moves
//   • Outbound throttle            → max one WS message per SEND_INTERVAL_MS
//   • Inbound remote cursors       → idempotent apply with sequence guard
//   • User colour assignment       → deterministic, stable per userId
//   • Stale cursor expiry          → entries older than EXPIRE_MS are swept
//   • Multi-tab dedup              → BroadcastChannel prevents echo
//
// ─── Sequence reconciliation ─────────────────────────────────────────────────
// Each outbound message carries a monotonically-increasing local seq number.
// Inbound messages with seq ≤ last-applied seq for that user are dropped.
// This prevents out-of-order network delivery from regressing the cursor.
//
// ─── Contracts guaranteed ────────────────────────────────────────────────────
//   • moveCursor() is safe to call on every mousemove/pointermove event.
//   • No DOM dependency — position is (x, y) in the caller's coordinate space.
//   • No mutation of BoardStoreState — cursors are ephemeral.
//   • No React dependency — pure class; consumed via exported hooks.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { telemetry } from "@/lib/telemetry/logEvent";

// ============================================================================
// 1.  Public types
// ============================================================================

export interface CursorPosition {
  readonly x: number;
  readonly y: number;
}

export interface CursorEntry {
  readonly userId:  string;
  readonly boardId: string;
  /** Coordinate space is defined by the consumer (e.g. board canvas pixels). */
  readonly position: CursorPosition;
  /** Deterministic hex colour assigned to this userId. */
  readonly color: string;
  /** Unix ms — used for expiry sweep. */
  readonly updatedAt: number;
  /**
   * Monotonic sequence counter per user.
   * Out-of-order inbound messages with seq ≤ lastSeq are dropped.
   */
  readonly seq: number;
}

/** Shape sent over WS and BroadcastChannel. */
export interface CursorMessage {
  readonly kind: "cursor.move" | "cursor.leave";
  readonly payload: {
    readonly userId:   string;
    readonly boardId:  string;
    readonly position?: CursorPosition;  // absent on cursor.leave
    readonly seq:      number;
  };
}

// ============================================================================
// 2.  Colour palette
//     26 visually-distinct colours chosen for legibility on dark backgrounds.
//     Assignment is userId → stable index via djb2 hash → no random drift.
// ============================================================================

const CURSOR_COLORS: readonly string[] = [
  "#F87171", "#FB923C", "#FBBF24", "#A3E635", "#34D399",
  "#22D3EE", "#60A5FA", "#818CF8", "#A78BFA", "#F472B6",
  "#E879F9", "#F43F5E", "#FCD34D", "#6EE7B7", "#93C5FD",
  "#C4B5FD", "#FCA5A5", "#FDBA74", "#FDE68A", "#BBF7D0",
  "#A5F3FC", "#BAE6FD", "#DDD6FE", "#FBCFE8", "#F9A8D4",
  "#D4D4D8",
] as const;

/** djb2 hash → stable palette index. Pure / deterministic. */
function assignColor(userId: string): string {
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 33) ^ userId.charCodeAt(i);
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length]!;
}

// ============================================================================
// 3.  Internal Zustand store
// ============================================================================

interface CursorStoreState {
  /** Local user's own cursor (for multi-tab sync display). */
  local: CursorEntry | null;
  /** All remote cursors keyed by userId. */
  remote: Record<string, CursorEntry>;

  /** Per-user last-applied seq counter (for out-of-order guard). */
  _lastSeq: Record<string, number>;

  _setLocal:     (entry: CursorEntry | null) => void;
  _upsertRemote: (entry: CursorEntry) => void;
  _removeRemote: (userId: string) => void;
  _sweepExpired: (now: number, expireAfterMs: number) => void;
}

const useCursorStore = create<CursorStoreState>()((set) => ({
  local:    null,
  remote:   {},
  _lastSeq: {},

  _setLocal: (entry) => set({ local: entry }),

  _upsertRemote: (entry) =>
    set((s) => {
      const lastSeq = s._lastSeq[entry.userId] ?? -1;
      // Out-of-order guard: silently drop stale messages.
      if (entry.seq <= lastSeq) return s;

      return {
        remote:   { ...s.remote,   [entry.userId]: entry },
        _lastSeq: { ...s._lastSeq, [entry.userId]: entry.seq },
      };
    }),

  _removeRemote: (userId) =>
    set((s) => {
      const { [userId]: _c, ...remoteRest } = s.remote;
      const { [userId]: _s, ...seqRest    } = s._lastSeq;
      return { remote: remoteRest, _lastSeq: seqRest };
    }),

  _sweepExpired: (now, expireAfterMs) =>
    set((s) => {
      const nextRemote: Record<string, CursorEntry> = {};
      const nextSeq:    Record<string, number>      = {};
      let changed = false;

      for (const [uid, entry] of Object.entries(s.remote)) {
        if (now - entry.updatedAt > expireAfterMs) {
          changed = true;
          telemetry.log("CURSOR", "REMOTE_CURSOR_EXPIRED", {
            userId: uid, updatedAt: entry.updatedAt,
          });
        } else {
          nextRemote[uid] = entry;
          nextSeq[uid]    = s._lastSeq[uid] ?? entry.seq;
        }
      }
      return changed ? { remote: nextRemote, _lastSeq: nextSeq } : s;
    }),
}));

// ============================================================================
// 4.  Constants
// ============================================================================

/** Minimum ms between outbound WS cursor messages. */
const SEND_INTERVAL_MS  = 50;    // ~20 updates/s max

/** Remote cursors disappear after this long without a refresh. */
const EXPIRE_MS         = 15_000;

/** Expiry sweep interval. */
const SWEEP_INTERVAL_MS = 8_000;

/**
 * Minimum pixel distance to consider a move "significant".
 * Tiny jitter below this threshold is coalesced and not sent.
 */
const MIN_DELTA_PX = 4;

const CHANNEL_NAME = "kiro:cursor";

// ============================================================================
// 5.  CursorManager
// ============================================================================

export class CursorManager {
  // ── identity ──────────────────────────────────────────────────────────────
  private userId:  string | null = null;
  private boardId: string | null = null;
  private localColor = "#FFFFFF";

  // ── transport ─────────────────────────────────────────────────────────────
  private readonly sendFn: (msg: CursorMessage) => void;

  // ── coalescing / batching state ───────────────────────────────────────────
  /**
   * Pending position queued by moveCursor() — flushed by the rAF callback.
   * null means no new movement since last flush.
   */
  private pending: CursorPosition | null = null;
  private rafId:   number | null = null;

  /** Last flushed position — used for MIN_DELTA_PX jitter filter. */
  private lastSentPosition: CursorPosition | null = null;

  /** Monotonic local seq counter for outbound messages. */
  private localSeq = 0;

  /** Timestamp of last actual WS send (for SEND_INTERVAL_MS throttle). */
  private lastSentAt = 0;

  // ── timers ────────────────────────────────────────────────────────────────
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  // ── multi-tab ─────────────────────────────────────────────────────────────
  private readonly tabId = crypto.randomUUID();
  private channel: BroadcastChannel | null = null;

  // ── public store ──────────────────────────────────────────────────────────
  readonly store = useCursorStore;

  constructor(sendFn: (msg: CursorMessage) => void) {
    this.sendFn = sendFn;
  }

  // ==========================================================================
  // 5a. Lifecycle
  // ==========================================================================

  init(boardId: string, userId: string) {
    this.boardId    = boardId;
    this.userId     = userId;
    this.localColor = assignColor(userId);

    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (
        ev: MessageEvent<CursorMessage & { _tabId?: string }>,
      ) => {
        this._handleTabMessage(ev.data);
      };
    }

    this.sweepTimer = setInterval(() => {
      useCursorStore.getState()._sweepExpired(Date.now(), EXPIRE_MS);
    }, SWEEP_INTERVAL_MS);

    telemetry.log("CURSOR", "INIT", { boardId, userId, color: this.localColor });
  }

  destroy() {
    // Cancel pending rAF.
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;

    // Notify peers that this cursor is gone.
    if (this.userId && this.boardId) {
      this._sendLeave();
    }

    this.channel?.close();
    this.channel = null;

    useCursorStore.getState()._setLocal(null);

    telemetry.log("CURSOR", "DESTROYED", { boardId: this.boardId });
  }

  // ==========================================================================
  // 5b. Local movement (call on mousemove / pointermove)
  // ==========================================================================

  /**
   * Queues a cursor position update.  Actual send is deferred to the next
   * animation frame so rapid mousemove events are coalesced into at most one
   * network message per frame, and filtered by MIN_DELTA_PX jitter threshold.
   */
  moveCursor(position: CursorPosition) {
    if (!this.userId || !this.boardId) return;

    // Overwrite pending — only the latest position per frame matters.
    this.pending = position;

    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this._flush());
    }
  }

  // ==========================================================================
  // 5c. Inbound remote cursors (called by BoardSocketClient)
  // ==========================================================================

  applyRemoteCursor(msg: CursorMessage) {
    if (!this.userId) return;
    if (msg.payload.userId === this.userId) return; // never echo own cursor

    if (msg.kind === "cursor.leave") {
      useCursorStore.getState()._removeRemote(msg.payload.userId);
      telemetry.log("CURSOR", "REMOTE_LEFT", { userId: msg.payload.userId });
      return;
    }

    if (!msg.payload.position) return;

    const entry: CursorEntry = {
      userId:    msg.payload.userId,
      boardId:   msg.payload.boardId,
      position:  msg.payload.position,
      color:     assignColor(msg.payload.userId),
      updatedAt: Date.now(),
      seq:       msg.payload.seq,
    };

    useCursorStore.getState()._upsertRemote(entry);

    // Forward to other same-origin tabs so all tabs show consistent cursors.
    this._tabBroadcast({ ...msg, _tabId: this.tabId });
  }

  // ==========================================================================
  // 5d. Internal flush (called by rAF)
  // ==========================================================================

  private _flush() {
    this.rafId = null;

    const position = this.pending;
    this.pending   = null;

    if (!position || !this.userId || !this.boardId) return;

    // Jitter filter: skip if movement is below threshold.
    if (this.lastSentPosition) {
      const dx = position.x - this.lastSentPosition.x;
      const dy = position.y - this.lastSentPosition.y;
      if (Math.sqrt(dx * dx + dy * dy) < MIN_DELTA_PX) return;
    }

    // Time-based throttle: if we sent too recently, re-queue for next frame.
    const now = Date.now();
    if (now - this.lastSentAt < SEND_INTERVAL_MS) {
      // Re-queue — we don't want to lose this move.
      this.pending = position;
      this.rafId   = requestAnimationFrame(() => this._flush());
      return;
    }

    this.lastSentAt       = now;
    this.lastSentPosition = position;
    this.localSeq         += 1;

    const entry: CursorEntry = {
      userId:    this.userId,
      boardId:   this.boardId,
      position,
      color:     this.localColor,
      updatedAt: now,
      seq:       this.localSeq,
    };

    // Update local store (other tabs read this for their own cursor display).
    useCursorStore.getState()._setLocal(entry);

    const msg: CursorMessage = {
      kind: "cursor.move",
      payload: {
        userId:   this.userId,
        boardId:  this.boardId,
        position,
        seq:      this.localSeq,
      },
    };

    this._sendAndBroadcast(msg);
  }

  // ==========================================================================
  // 5e. Leave
  // ==========================================================================

  private _sendLeave() {
    this.localSeq += 1;
    const msg: CursorMessage = {
      kind: "cursor.leave",
      payload: {
        userId:  this.userId!,
        boardId: this.boardId!,
        seq:     this.localSeq,
      },
    };
    try {
      this.sendFn(msg);
    } catch {
      // WS may already be closed — not critical.
    }
    this._tabBroadcast({ ...msg, _tabId: this.tabId });
    telemetry.log("CURSOR", "LEAVE_SENT", { userId: this.userId });
  }

  // ==========================================================================
  // 5f. Multi-tab helpers
  // ==========================================================================

  private _sendAndBroadcast(msg: CursorMessage) {
    try {
      this.sendFn(msg);
    } catch (err) {
      telemetry.log("CURSOR", "SEND_FAILED", { error: String(err) });
    }
    this._tabBroadcast({ ...msg, _tabId: this.tabId });
  }

  private _handleTabMessage(msg: CursorMessage & { _tabId?: string }) {
    if (msg._tabId === this.tabId) return; // own echo
    this.applyRemoteCursor(msg);
  }

  private _tabBroadcast(msg: CursorMessage & { _tabId?: string }) {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // Channel closed — safe to ignore.
    }
  }
}

// ============================================================================
// 6.  Public helpers
// ============================================================================

/**
 * Returns the deterministic colour for any userId.
 * Useful for rendering cursor labels / avatars without accessing the store.
 */
export { assignColor as getCursorColor };

// ============================================================================
// 7.  React hooks
// ============================================================================

/** All remote cursors currently visible on the board. */
export function useRemoteCursors(): Record<string, CursorEntry> {
  return useCursorStore((s) => s.remote);
}

/** The local user's own cursor entry (for rendering a self-indicator). */
export function useLocalCursor(): CursorEntry | null {
  return useCursorStore((s) => s.local);
}

/**
 * Cursor entry for a single peer.
 * More granular than useRemoteCursors() — only re-renders when that
 * specific peer's position changes.
 */
export function usePeerCursor(userId: string): CursorEntry | undefined {
  return useCursorStore((s) => s.remote[userId]);
}
