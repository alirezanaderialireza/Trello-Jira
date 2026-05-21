// apps/web/src/features/board/store/sync/collaboration/selectionManager.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Tracks which items (cards, lists) each user has selected on a board.
// Owns:
//   • Local optimistic selection    → visible immediately, no WS round-trip
//   • ACL-aware select gate         → per-item permission check before select
//   • Outbound WS notification      → throttled, batched diff
//   • Inbound remote selections     → idempotent apply
//   • Multi-tab dedup               → BroadcastChannel leader owns WS send
//   • Stale entry expiry            → entries without refresh are swept
//
// ─── ACL contract ────────────────────────────────────────────────────────────
// The manager accepts an injectable `aclFn` with signature:
//   (itemId: string, userId: string) => SelectionPermission
// This keeps the manager decoupled from the actual ACL engine (Phase 2).
// When no aclFn is provided, all selections are permitted (open default).
//
// ─── Multi-tab dedup ─────────────────────────────────────────────────────────
// The same user may have the board open in multiple tabs.  We want exactly one
// "active selection" broadcast per user, not one per tab.  Strategy:
//   • BroadcastChannel SELECTION_UPDATE carries the originating tabId.
//   • Each tab applies the update to its local store.
//   • Only the tab that owns the selection (originTabId === this.tabId) sends
//     the WS message.  Other tabs skip the WS send.
//
// ─── Contracts guaranteed ────────────────────────────────────────────────────
//   • select() / deselect() are idempotent.
//   • clearAll() removes all local selections and notifies peers.
//   • Remote selections never overwrite local — they live in separate slices.
//   • No mutation of BoardStoreState — selections are ephemeral UI state.
//   • No React dependency — pure class; consumed via exported hooks.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { telemetry } from "../../../devtools/logEvent";

// ============================================================================
// 1.  Public types
// ============================================================================

export type SelectableKind = "card" | "list";

export interface SelectionItem {
  readonly itemId: string;
  readonly kind:   SelectableKind;
}

export type SelectionPermission = "allowed" | "denied" | "read_only";

/** Injectable ACL function — decouples manager from Phase 2 ACL engine. */
export type AclFn = (item: SelectionItem, userId: string) => SelectionPermission;

export interface SelectionEntry {
  readonly userId:   string;
  readonly boardId:  string;
  /** Ordered array so UI can render selection in a stable order. */
  readonly items:    readonly SelectionItem[];
  readonly updatedAt: number;
}

/** Shape sent over WS and BroadcastChannel. */
export interface SelectionMessage {
  readonly kind: "selection.update" | "selection.clear";
  readonly payload: {
    readonly userId:  string;
    readonly boardId: string;
    readonly items:   readonly SelectionItem[];  // empty on selection.clear
  };
}

// ============================================================================
// 2.  Internal Zustand store
// ============================================================================

interface SelectionStoreState {
  /** Local user's own selection — optimistic, immediately visible. */
  local: SelectionEntry | null;
  /** All remote peers' selections keyed by userId. */
  remote: Record<string, SelectionEntry>;

  _setLocal:     (entry: SelectionEntry | null) => void;
  _upsertRemote: (entry: SelectionEntry) => void;
  _removeRemote: (userId: string) => void;
  _sweepExpired: (now: number, expireAfterMs: number) => void;
}

const useSelectionStore = create<SelectionStoreState>()((set) => ({
  local:  null,
  remote: {},

  _setLocal: (entry) => set({ local: entry }),

  _upsertRemote: (entry) =>
    set((s) => ({
      remote: { ...s.remote, [entry.userId]: entry },
    })),

  _removeRemote: (userId) =>
    set((s) => {
      const { [userId]: _, ...rest } = s.remote;
      return { remote: rest };
    }),

  _sweepExpired: (now, expireAfterMs) =>
    set((s) => {
      const next: Record<string, SelectionEntry> = {};
      let changed = false;
      for (const [uid, entry] of Object.entries(s.remote)) {
        if (now - entry.updatedAt > expireAfterMs) {
          changed = true;
          telemetry.log("SELECTION", "REMOTE_EXPIRED", {
            userId: uid,
            itemCount: entry.items.length,
          });
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

const EXPIRE_MS        = 30_000;   // remote selections expire after 30 s
const SWEEP_INTERVAL   = 15_000;   // sweep every 15 s
const SEND_THROTTLE_MS = 80;       // max ~12 WS messages/s for selection changes
const CHANNEL_NAME     = "kiro:selection";

// ============================================================================
// 4.  SelectionManager
// ============================================================================

export class SelectionManager {
  // ── identity ──────────────────────────────────────────────────────────────
  private userId:  string | null = null;
  private boardId: string | null = null;

  // ── transport ─────────────────────────────────────────────────────────────
  private readonly sendFn: (msg: SelectionMessage) => void;

  // ── ACL ───────────────────────────────────────────────────────────────────
  private readonly aclFn: AclFn;

  // ── timers / throttle ─────────────────────────────────────────────────────
  private sweepTimer:  ReturnType<typeof setInterval>  | null = null;
  private sendTimer:   ReturnType<typeof setTimeout>   | null = null;
  private lastSentAt = 0;
  /** Dirty flag — true when local selection changed but WS not yet flushed. */
  private dirty = false;

  // ── multi-tab ─────────────────────────────────────────────────────────────
  private readonly tabId = crypto.randomUUID();
  private channel: BroadcastChannel | null = null;

  // ── public store ──────────────────────────────────────────────────────────
  readonly store = useSelectionStore;

  constructor(
    sendFn: (msg: SelectionMessage) => void,
    aclFn: AclFn = () => "allowed",  // open by default
  ) {
    this.sendFn = sendFn;
    this.aclFn  = aclFn;
  }

  // ==========================================================================
  // 4a. Lifecycle
  // ==========================================================================

  init(boardId: string, userId: string) {
    this.boardId = boardId;
    this.userId  = userId;

    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (
        ev: MessageEvent<SelectionMessage & { _tabId?: string }>,
      ) => {
        this._handleTabMessage(ev.data);
      };
    }

    this.sweepTimer = setInterval(() => {
      useSelectionStore.getState()._sweepExpired(Date.now(), EXPIRE_MS);
    }, SWEEP_INTERVAL);

    telemetry.log("SELECTION", "INIT", { boardId, userId });
  }

  destroy() {
    if (this.sendTimer)  clearTimeout(this.sendTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sendTimer  = null;
    this.sweepTimer = null;

    // Notify peers that our selection is cleared.
    const local = useSelectionStore.getState().local;
    if (local && local.items.length > 0) {
      this._sendMessage({ kind: "selection.clear", payload: { userId: this.userId!, boardId: this.boardId!, items: [] } });
    }

    useSelectionStore.getState()._setLocal(null);
    this.channel?.close();
    this.channel = null;

    telemetry.log("SELECTION", "DESTROYED", { boardId: this.boardId });
  }

  // ==========================================================================
  // 4b. Local selection mutations
  // ==========================================================================

  /**
   * Add item to local selection.
   * ACL is checked before adding — denied items are silently skipped.
   * Returns the permission result so the caller can show feedback if needed.
   */
  select(item: SelectionItem): SelectionPermission {
    if (!this.userId || !this.boardId) return "denied";

    const permission = this.aclFn(item, this.userId);

    if (permission === "denied") {
      telemetry.log("SELECTION", "SELECT_DENIED_BY_ACL", {
        itemId: item.itemId,
        kind:   item.kind,
        userId: this.userId,
      });
      return "denied";
    }

    const store   = useSelectionStore.getState();
    const current = store.local?.items ?? [];

    // Idempotent — do nothing if already selected.
    if (current.some((i) => i.itemId === item.itemId)) return permission;

    const nextItems: SelectionItem[] = [...current, item];
    this._applyLocal(nextItems);

    telemetry.log("SELECTION", "SELECT_LOCAL", {
      itemId:     item.itemId,
      kind:       item.kind,
      totalItems: nextItems.length,
    });

    return permission;
  }

  /** Remove a single item from local selection. Idempotent. */
  deselect(itemId: string) {
    if (!this.userId || !this.boardId) return;

    const store   = useSelectionStore.getState();
    const current = store.local?.items ?? [];
    const next    = current.filter((i) => i.itemId !== itemId);

    if (next.length === current.length) return; // nothing changed

    this._applyLocal(next);

    telemetry.log("SELECTION", "DESELECT_LOCAL", { itemId, remaining: next.length });
  }

  /**
   * Replace the entire local selection atomically.
   * ACL is applied per item — denied items are filtered out.
   */
  setSelection(items: SelectionItem[]) {
    if (!this.userId || !this.boardId) return;

    const allowed = items.filter(
      (item) => this.aclFn(item, this.userId!) !== "denied",
    );

    this._applyLocal(allowed);

    telemetry.log("SELECTION", "SET_SELECTION", {
      requested: items.length,
      allowed:   allowed.length,
    });
  }

  /** Clear all local selections and broadcast immediately. */
  clearAll() {
    if (!this.userId || !this.boardId) return;

    useSelectionStore.getState()._setLocal({
      userId:    this.userId,
      boardId:   this.boardId,
      items:     [],
      updatedAt: Date.now(),
    });

    // Clear is high-priority — bypass throttle.
    this._cancelPendingSend();
    this._sendMessage({
      kind:    "selection.clear",
      payload: { userId: this.userId, boardId: this.boardId, items: [] },
    });

    telemetry.log("SELECTION", "CLEAR_ALL", { userId: this.userId });
  }

  // ==========================================================================
  // 4c. Inbound remote selections (called by BoardSocketClient)
  // ==========================================================================

  applyRemoteSelection(msg: SelectionMessage) {
    if (!this.userId) return;
    if (msg.payload.userId === this.userId) return; // never echo own

    const now = Date.now();

    if (msg.kind === "selection.clear" || msg.payload.items.length === 0) {
      useSelectionStore.getState()._removeRemote(msg.payload.userId);
      telemetry.log("SELECTION", "REMOTE_CLEARED", { userId: msg.payload.userId });
      return;
    }

    const entry: SelectionEntry = {
      userId:    msg.payload.userId,
      boardId:   msg.payload.boardId,
      items:     msg.payload.items,
      updatedAt: now,
    };

    useSelectionStore.getState()._upsertRemote(entry);

    // Forward to other same-origin tabs.
    this._tabBroadcast({ ...msg, _tabId: this.tabId });

    telemetry.log("SELECTION", "REMOTE_APPLIED", {
      userId:    msg.payload.userId,
      itemCount: msg.payload.items.length,
    });
  }

  // ==========================================================================
  // 4d. Query helpers (synchronous, no subscription needed)
  // ==========================================================================

  /** Returns all userIds who have a given itemId selected. */
  getUsersSelectingItem(itemId: string): string[] {
    const { local, remote } = useSelectionStore.getState();
    const result: string[] = [];

    if (local?.items.some((i) => i.itemId === itemId)) {
      result.push(local.userId);
    }
    for (const entry of Object.values(remote)) {
      if (entry.items.some((i) => i.itemId === itemId)) {
        result.push(entry.userId);
      }
    }
    return result;
  }

  /** Returns true if the local user currently has itemId selected. */
  isLocallySelected(itemId: string): boolean {
    return (
      useSelectionStore.getState().local?.items.some(
        (i) => i.itemId === itemId,
      ) ?? false
    );
  }

  // ==========================================================================
  // 4e. Internal — apply local changes + schedule WS flush
  // ==========================================================================

  private _applyLocal(items: SelectionItem[]) {
    useSelectionStore.getState()._setLocal({
      userId:    this.userId!,
      boardId:   this.boardId!,
      items,
      updatedAt: Date.now(),
    });

    // Broadcast immediately to same-origin tabs for instant UI sync.
    this._tabBroadcast({
      kind: items.length === 0 ? "selection.clear" : "selection.update",
      payload: { userId: this.userId!, boardId: this.boardId!, items },
      _tabId: this.tabId,
    });

    this._scheduleSend(items);
  }

  private _scheduleSend(items: SelectionItem[]) {
    const now = Date.now();
    this.dirty = true;

    if (now - this.lastSentAt >= SEND_THROTTLE_MS) {
      // Within budget — send immediately.
      this._flush(items);
    } else {
      // Over budget — defer until the throttle window expires.
      this._cancelPendingSend();
      const delay = SEND_THROTTLE_MS - (now - this.lastSentAt);
      this.sendTimer = setTimeout(() => {
        if (!this.dirty) return;
        const current = useSelectionStore.getState().local?.items ?? [];
        this._flush([...current]);
      }, delay);
    }
  }

  private _flush(items: SelectionItem[]) {
    this.dirty      = false;
    this.lastSentAt = Date.now();

    const msg: SelectionMessage = {
      kind:    items.length === 0 ? "selection.clear" : "selection.update",
      payload: { userId: this.userId!, boardId: this.boardId!, items },
    };

    this._sendMessage(msg);
  }

  private _cancelPendingSend() {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
    }
  }

  private _sendMessage(msg: SelectionMessage) {
    try {
      this.sendFn(msg);
    } catch (err) {
      telemetry.log("SELECTION", "SEND_FAILED", { error: String(err) });
    }
  }

  // ==========================================================================
  // 4f. Multi-tab helpers
  // ==========================================================================

  private _handleTabMessage(msg: SelectionMessage & { _tabId?: string }) {
    if (msg._tabId === this.tabId) return; // own echo

    // If this is the local user's own selection being mirrored from another tab,
    // update our local store slice (not remote) — no WS send.
    if (msg.payload.userId === this.userId) {
      const items: SelectionItem[] = msg.kind === "selection.clear" ? [] : [...msg.payload.items];
      useSelectionStore.getState()._setLocal(
        items.length === 0
          ? null
          : { userId: this.userId, boardId: this.boardId!, items, updatedAt: Date.now() },
      );
      return;
    }

    // Otherwise, treat as a remote peer update.
    this.applyRemoteSelection(msg);
  }

  private _tabBroadcast(msg: SelectionMessage & { _tabId?: string }) {
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

/** The local user's current selection. */
export function useLocalSelection(): SelectionEntry | null {
  return useSelectionStore((s) => s.local);
}

/** All remote peers' selections. */
export function useRemoteSelections(): Record<string, SelectionEntry> {
  return useSelectionStore((s) => s.remote);
}

/**
 * Returns all userIds who have a specific item selected (local + remote).
 * Re-renders only when the set of selecting users changes for this item.
 */
export function useItemSelectors(itemId: string): string[] {
  return useSelectionStore((s) => {
    const result: string[] = [];
    if (s.local?.items.some((i) => i.itemId === itemId)) {
      result.push(s.local.userId);
    }
    for (const entry of Object.values(s.remote)) {
      if (entry.items.some((i) => i.itemId === itemId)) {
        result.push(entry.userId);
      }
    }
    return result;
  });
}

/**
 * Returns true if a specific item is selected by the local user.
 * Granular subscription — only rerenders for this item's state.
 */
export function useIsSelected(itemId: string): boolean {
  return useSelectionStore((s) =>
    s.local?.items.some((i) => i.itemId === itemId) ?? false,
  );
}
