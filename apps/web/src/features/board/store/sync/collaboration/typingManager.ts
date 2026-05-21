// apps/web/src/features/board/store/sync/collaboration/typingManager.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Tracks who is typing where (cardId / listId / field context).
// Owns:
//   • optimistic local typing state  → visible immediately in UI
//   • idle-reset timeout             → clears typing after IDLE_TIMEOUT_MS silence
//   • outbound WS message            → notifies all peers
//   • inbound remote typing events   → applied idempotently
//   • multi-tab dedup                → BroadcastChannel prevents echo between tabs
//
// ─── Contracts guaranteed ────────────────────────────────────────────────────
//   • startTyping() is safe to call on every keystroke (debounced internally).
//   • stopTyping()  is idempotent — calling it when already stopped is a no-op.
//   • Remote entries expire after REMOTE_EXPIRE_MS without a refresh.
//   • No mutation of BoardStoreState — typing is ephemeral / non-domain state.
//   • No React dependency — pure class, consumed via exported hooks.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { telemetry } from "../../../devtools/logEvent";

// ============================================================================
// 1.  Public Types
// ============================================================================

/** Granularity: which field inside a card/list is being typed into. */
export type TypingField = "title" | "description" | "comment" | "list_title";

export interface TypingContext {
  /** The entity being edited. Exactly one of cardId / listId must be set. */
  readonly cardId?: string;
  readonly listId?: string;
  /** Which field within that entity. */
  readonly field: TypingField;
}

export interface TypingEntry {
  readonly userId: string;
  readonly boardId: string;
  readonly context: TypingContext;
  /** Unix ms — when this entry was last refreshed. */
  readonly startedAt: number;
  readonly updatedAt: number;
}

/** Message shape sent over WS / BroadcastChannel. */
export interface TypingMessage {
  readonly kind: "typing.start" | "typing.stop";
  readonly payload: {
    readonly userId: string;
    readonly boardId: string;
    readonly context: TypingContext;
  };
}

// ============================================================================
// 2.  Internal store key
//     key = `${userId}:${cardId ?? listId}:${field}`
// ============================================================================

function makeKey(userId: string, ctx: TypingContext): string {
  const entity = ctx.cardId ?? ctx.listId ?? "board";
  return `${userId}:${entity}:${ctx.field}`;
}

// ============================================================================
// 3.  Internal Zustand store
// ============================================================================

interface TypingStoreState {
  /** Whether the local user is currently typing (optimistic). */
  localIsTyping: boolean;
  localContext: TypingContext | null;

  /** All active typing entries keyed by makeKey(). */
  entries: Record<string, TypingEntry>;

  _setLocalTyping: (isTyping: boolean, ctx: TypingContext | null) => void;
  _upsertEntry:    (entry: TypingEntry) => void;
  _removeEntry:    (key: string) => void;
  _sweepExpired:   (now: number, expireAfterMs: number) => void;
}

const useTypingStore = create<TypingStoreState>()((set) => ({
  localIsTyping: false,
  localContext:  null,
  entries:       {},

  _setLocalTyping: (isTyping, ctx) =>
    set({ localIsTyping: isTyping, localContext: ctx }),

  _upsertEntry: (entry) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [makeKey(entry.userId, entry.context)]: entry,
      },
    })),

  _removeEntry: (key) =>
    set((s) => {
      const { [key]: _, ...rest } = s.entries;
      return { entries: rest };
    }),

  _sweepExpired: (now, expireAfterMs) =>
    set((s) => {
      const next: Record<string, TypingEntry> = {};
      let changed = false;
      for (const [key, entry] of Object.entries(s.entries)) {
        if (now - entry.updatedAt > expireAfterMs) {
          changed = true;
          telemetry.log(
            "TYPING",
            "REMOTE_ENTRY_EXPIRED",
            { userId: entry.userId, context: entry.context },
          );
        } else {
          next[key] = entry;
        }
      }
      return changed ? { entries: next } : s;
    }),
}));

// ============================================================================
// 4.  Constants
// ============================================================================

/** After this many ms of no startTyping() calls → automatically stop. */
const IDLE_TIMEOUT_MS    = 4_000;

/** Remote entries expire after this long without a refresh. */
const REMOTE_EXPIRE_MS   = 12_000;

/** Sweep interval for remote expiry. */
const SWEEP_INTERVAL_MS  = 6_000;

/** Minimum interval between outbound WS "typing.start" messages to reduce
 *  network spam when the user types fast. */
const SEND_THROTTLE_MS   = 1_500;

const CHANNEL_NAME = "kiro:typing";

// ============================================================================
// 5.  TypingManager
// ============================================================================

export class TypingManager {
  // ── identity ──────────────────────────────────────────────────────────────
  private userId:  string | null = null;
  private boardId: string | null = null;

  // ── transport ─────────────────────────────────────────────────────────────
  private readonly sendFn: (msg: TypingMessage) => void;

  // ── timers ────────────────────────────────────────────────────────────────
  private idleTimer:   ReturnType<typeof setTimeout>  | null = null;
  private sweepTimer:  ReturnType<typeof setInterval> | null = null;

  // ── throttle state ────────────────────────────────────────────────────────
  private lastSentAt = 0;

  // ── multi-tab dedup ───────────────────────────────────────────────────────
  private readonly tabId = crypto.randomUUID();
  private channel: BroadcastChannel | null = null;

  // ── public reactive store ─────────────────────────────────────────────────
  readonly store = useTypingStore;

  constructor(sendFn: (msg: TypingMessage) => void) {
    this.sendFn = sendFn;
  }

  // ==========================================================================
  // 5a. Lifecycle
  // ==========================================================================

  init(boardId: string, userId: string) {
    this.boardId = boardId;
    this.userId  = userId;

    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (ev: MessageEvent<TypingMessage & { _tabId?: string }>) => {
        this._handleTabMessage(ev.data);
      };
    }

    this.sweepTimer = setInterval(() => {
      useTypingStore.getState()._sweepExpired(Date.now(), REMOTE_EXPIRE_MS);
    }, SWEEP_INTERVAL_MS);

    telemetry.log("TYPING", "INIT", { boardId, userId });
  }

  destroy() {
    this._clearIdleTimer();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;

    // If still typing, send a stop before tearing down.
    const { localIsTyping, localContext } = useTypingStore.getState();
    if (localIsTyping && localContext) {
      this._broadcastStop(localContext);
    }

    this.channel?.close();
    this.channel = null;

    telemetry.log("TYPING", "DESTROYED", { boardId: this.boardId });
  }

  // ==========================================================================
  // 5b. Local user actions (call on every relevant input event)
  // ==========================================================================

  /**
   * Call on every `input` / `onChange` event inside an editable field.
   * Idempotent and safe to hammer — internal throttle handles WS rate limiting.
   */
  startTyping(ctx: TypingContext) {
    if (!this.userId || !this.boardId) return;

    const store = useTypingStore.getState();
    const now   = Date.now();

    // Optimistic local update — immediate.
    store._setLocalTyping(true, ctx);

    // Reset the idle timer on every keystroke.
    this._resetIdleTimer(ctx);

    // Throttle outbound WS messages.
    if (now - this.lastSentAt < SEND_THROTTLE_MS) return;
    this.lastSentAt = now;

    const msg = this._buildMessage("typing.start", ctx);
    this._sendAndBroadcast(msg);

    telemetry.log("TYPING", "START_SENT", { userId: this.userId, context: ctx });
  }

  /**
   * Call when the user explicitly blurs a field or closes an editor.
   * Also called automatically after IDLE_TIMEOUT_MS.
   */
  stopTyping(ctx?: TypingContext) {
    if (!this.userId || !this.boardId) return;

    const store = useTypingStore.getState();
    const resolvedCtx = ctx ?? store.localContext;

    if (!store.localIsTyping || !resolvedCtx) return;

    store._setLocalTyping(false, null);
    this._clearIdleTimer();

    const msg = this._buildMessage("typing.stop", resolvedCtx);
    this._sendAndBroadcast(msg);

    telemetry.log("TYPING", "STOP_SENT", { userId: this.userId, context: resolvedCtx });
  }

  // ==========================================================================
  // 5c. Inbound remote typing events (called by BoardSocketClient)
  // ==========================================================================

  applyRemoteTyping(msg: TypingMessage) {
    if (!this.userId) return;
    // Never reflect own messages back.
    if (msg.payload.userId === this.userId) return;

    const now = Date.now();
    const store = useTypingStore.getState();

    if (msg.kind === "typing.start") {
      const entry: TypingEntry = {
        userId:   msg.payload.userId,
        boardId:  msg.payload.boardId,
        context:  msg.payload.context,
        startedAt: now,
        updatedAt: now,
      };
      store._upsertEntry(entry);

      telemetry.log("TYPING", "REMOTE_START_APPLIED", {
        userId:  msg.payload.userId,
        context: msg.payload.context,
      });
    } else {
      // typing.stop
      const key = makeKey(msg.payload.userId, msg.payload.context);
      store._removeEntry(key);

      telemetry.log("TYPING", "REMOTE_STOP_APPLIED", {
        userId:  msg.payload.userId,
        context: msg.payload.context,
      });
    }
  }

  // ==========================================================================
  // 5d. Internal helpers
  // ==========================================================================

  private _resetIdleTimer(ctx: TypingContext) {
    this._clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.stopTyping(ctx);
      telemetry.log("TYPING", "IDLE_TIMEOUT_FIRED", { context: ctx });
    }, IDLE_TIMEOUT_MS);
  }

  private _clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private _buildMessage(
    kind: TypingMessage["kind"],
    ctx: TypingContext,
  ): TypingMessage {
    return {
      kind,
      payload: {
        userId:  this.userId!,
        boardId: this.boardId!,
        context: ctx,
      },
    };
  }

  private _sendAndBroadcast(msg: TypingMessage) {
    // 1. Send over WS.
    try {
      this.sendFn(msg);
    } catch (err) {
      telemetry.log("TYPING", "SEND_FAILED", { error: String(err) });
    }

    // 2. Broadcast to other tabs so they show the local user's typing indicator
    //    in sync without a WS round-trip.
    this._tabBroadcast({ ...msg, _tabId: this.tabId });
  }

  private _broadcastStop(ctx: TypingContext) {
    const msg = this._buildMessage("typing.stop", ctx);
    this._sendAndBroadcast(msg);
  }

  private _handleTabMessage(msg: TypingMessage & { _tabId?: string }) {
    // Ignore messages originating from this tab to prevent double-application.
    if (msg._tabId === this.tabId) return;
    this.applyRemoteTyping(msg);
  }

  private _tabBroadcast(msg: TypingMessage & { _tabId?: string }) {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // Channel closed — safe to ignore.
    }
  }
}

// ============================================================================
// 6.  React hooks
// ============================================================================

/**
 * Returns all users currently typing in a given card / list field.
 * Memoised by context keys — will only rerender when the set changes.
 */
export function useTypingUsers(ctx: TypingContext): TypingEntry[] {
  return useTypingStore((s) => {
    const entity = ctx.cardId ?? ctx.listId;
    return Object.values(s.entries).filter(
      (e) =>
        e.context.field === ctx.field &&
        (ctx.cardId
          ? e.context.cardId === ctx.cardId
          : e.context.listId === ctx.listId),
    );
  });
}

/** True if the local user's own typing indicator is active. */
export function useIsLocalTyping(): boolean {
  return useTypingStore((s) => s.localIsTyping);
}
