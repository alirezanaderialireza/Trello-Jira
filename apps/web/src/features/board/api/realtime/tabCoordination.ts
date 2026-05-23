// apps/web/src/features/board/api/realtime/tabCoordination.ts
//
// ============================================================================
// 🪟 TabCoordination — BroadcastChannel Multi-Tab Sync
// ============================================================================
//
// Problem:
// ────────
// When a user has the same board open in multiple tabs, each tab has its own
// independent WS connection and Zustand store.  Without coordination:
//
//   1. Double-apply: Tab A applies optimistic card.created (tempId="tmp-1").
//      Tab B receives the same WS ACK echo and tries to reconcile tempId,
//      but never saw the optimistic write → corruption / ghost card.
//
//   2. Sequence drift: Tab A is at seq=50; Tab B is at seq=48 (was backgrounded).
//      Both receive seq=51 — Tab A applies it, Tab B buffers it incorrectly.
//
//   3. Stale pendingMutations: Tab A creates a card, Tab B is on the same
//      board and receives the ACK — Tab A's mutation stays "pending" forever
//      because Tab B can't call resolvePendingMutation on Tab A's store.
//
// Solution — BroadcastChannel:
// ────────────────────────────
// Every tab that opens a board joins the same BroadcastChannel named
// "board-sync:{boardId}".
//
// Protocol messages:
//
//   SEQ_ADVANCE      — A tab advanced boardSequence (applied WS event).
//                       Other tabs learn the canonical sequence without
//                       applying the same event twice.
//
//   MUTATION_ACKED   — A tab received a WS ACK for correlationId.
//                       Other tabs remove that mutation from pendingMutations
//                       to prevent orphan mutations that never get GC'd.
//
//   LEADER_ANNOUNCE  — One tab per board claims the "WS leader" role.
//                       Non-leader tabs go read-only on the WS layer
//                       (they still apply store updates from SEQ_ADVANCE).
//
//   LEADER_HEARTBEAT — Leader sends a heartbeat every LEADER_HB_MS.
//                       If a non-leader sees no heartbeat for LEADER_TIMEOUT_MS
//                       it promotes itself to leader.
//
// Multi-tab conflict policy:
// ──────────────────────────
// Each tab is authoritative for its own optimistic mutations.
// Server-authoritative events (WS echo with correlationId) are broadcast
// so ALL tabs can clean up their pendingMutations, not just the originator.
//
// The WS leader concept is ADVISORY ONLY in this implementation:
//   • All tabs still maintain their own WS connections (simpler, safer).
//   • Leadership is used only to serialize outbox retries — only the leader
//     retries stale mutations, preventing duplicate HTTP calls.
//
// Browser support:
// ────────────────
// BroadcastChannel is supported in all modern browsers.
// In SSR/Node environments (Next.js server components) the class is a no-op
// so the guard `typeof BroadcastChannel === "undefined"` is always checked.
//
// ============================================================================

import { telemetry } from "@/lib/telemetry/logEvent";

// ============================================================================
// 📨 Message Protocol
// ============================================================================

export type TabMessage =
  | {
      type:        "SEQ_ADVANCE";
      boardId:     string;
      sequence:    string;     // BigInt-safe string from boardSequence
      tabId:       string;
    }
  | {
      type:          "MUTATION_ACKED";
      boardId:       string;
      correlationId: string;
      tabId:         string;
    }
  | {
      type:    "LEADER_ANNOUNCE";
      boardId: string;
      tabId:   string;
    }
  | {
      type:    "LEADER_HEARTBEAT";
      boardId: string;
      tabId:   string;
    };

// ============================================================================
// ⚙️ Config
// ============================================================================

const LEADER_HB_MS      = 5_000;   // Leader heartbeat interval
const LEADER_TIMEOUT_MS = 12_000;  // Timeout before a follower self-promotes

// ============================================================================
// 🪟 TabCoordination
// ============================================================================

export class TabCoordination {
  private readonly tabId:   string;
  private boardId:          string | null = null;
  private channel:          BroadcastChannel | null = null;

  // Callbacks injected by boardRealtimeClient
  private _onRemoteSeqAdvance:  ((seq: string) => void)        | null = null;
  private _onRemoteMutationAck: ((correlationId: string) => void) | null = null;
  private _onLeaderChanged:     ((isLeader: boolean) => void)  | null = null;

  // Leader state
  private _isLeader        = false;
  private _leaderTabId:    string | null = null;
  private _leaderHbTimer:  ReturnType<typeof setInterval>  | null = null;
  private _leaderWatchdog: ReturnType<typeof setTimeout>   | null = null;

  constructor() {
    this.tabId = crypto.randomUUID();
  }

  // ==========================================================================
  // ▶️ Lifecycle
  // ==========================================================================

  /**
   * Join the coordination channel for a board.
   * Called by boardRealtimeClient.connect().
   */
  open(
    boardId: string,
    callbacks: {
      onRemoteSeqAdvance:  (seq: string) => void;
      onRemoteMutationAck: (correlationId: string) => void;
      onLeaderChanged:     (isLeader: boolean) => void;
    },
  ): void {
    // Close any existing channel first (board switch)
    this.close();

    this.boardId = boardId;
    this._onRemoteSeqAdvance  = callbacks.onRemoteSeqAdvance;
    this._onRemoteMutationAck = callbacks.onRemoteMutationAck;
    this._onLeaderChanged     = callbacks.onLeaderChanged;

    if (typeof BroadcastChannel === "undefined") {
      // SSR / environments without BroadcastChannel — run as sole "leader"
      this._promoteToLeader();
      return;
    }

    this.channel = new BroadcastChannel(`board-sync:${boardId}`);
    this.channel.onmessage = (ev: MessageEvent<TabMessage>) => {
      this._handleMessage(ev.data);
    };

    // Announce ourselves and attempt to claim leadership
    this._announceLeader();
    this._startLeaderWatchdog();

    telemetry.log("TAB_COORDINATION", "OPENED", { boardId, tabId: this.tabId });
  }

  /**
   * Leave the coordination channel.
   * Called by boardRealtimeClient.disconnect().
   */
  close(): void {
    this._clearLeaderTimers();

    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = null;
    }

    this._isLeader    = false;
    this._leaderTabId = null;
    this.boardId      = null;

    telemetry.log("TAB_COORDINATION", "CLOSED", { tabId: this.tabId });
  }

  // ==========================================================================
  // 📢 Outbound broadcasts (called by boardRealtimeClient)
  // ==========================================================================

  /**
   * Broadcast that this tab has applied a WS event and advanced its sequence.
   * Other tabs will update their boardSequence guard to avoid buffering events
   * they've already effectively learned about.
   */
  broadcastSeqAdvance(sequence: string): void {
    this._send({
      type: "SEQ_ADVANCE",
      boardId: this.boardId!,
      sequence,
      tabId: this.tabId,
    });
  }

  /**
   * Broadcast that this tab received a WS ACK for a mutation.
   * Other tabs should remove that correlationId from their pendingMutations.
   */
  broadcastMutationAck(correlationId: string): void {
    this._send({
      type:          "MUTATION_ACKED",
      boardId:       this.boardId!,
      correlationId,
      tabId:         this.tabId,
    });
  }

  // ==========================================================================
  // 🏆 Leader state
  // ==========================================================================

  get isLeader(): boolean { return this._isLeader; }
  get currentTabId(): string { return this.tabId; }

  // ==========================================================================
  // 🔧 Internal — message handler
  // ==========================================================================

  private _handleMessage(msg: TabMessage): void {
    // Ignore messages from ourselves
    if (msg.tabId === this.tabId) return;
    // Ignore messages for other boards (shouldn't happen with per-board channel name)
    if (msg.boardId !== this.boardId) return;

    switch (msg.type) {
      case "SEQ_ADVANCE": {
        telemetry.log("TAB_COORDINATION", "REMOTE_SEQ_ADVANCE", {
          seq: msg.sequence, fromTab: msg.tabId,
        });
        this._onRemoteSeqAdvance?.(msg.sequence);
        break;
      }

      case "MUTATION_ACKED": {
        telemetry.log("TAB_COORDINATION", "REMOTE_MUTATION_ACKED", {
          correlationId: msg.correlationId, fromTab: msg.tabId,
        });
        this._onRemoteMutationAck?.(msg.correlationId);
        break;
      }

      case "LEADER_ANNOUNCE": {
        // Another tab claims leadership — yield if they got here first
        // (heuristic: compare tabIds for determinism)
        if (this._isLeader && msg.tabId < this.tabId) {
          this._yieldLeadership();
        } else if (!this._isLeader) {
          this._leaderTabId = msg.tabId;
          this._resetLeaderWatchdog();
        }
        break;
      }

      case "LEADER_HEARTBEAT": {
        // Active leader heartbeat — reset watchdog so we don't self-promote
        if (msg.tabId === this._leaderTabId || !this._isLeader) {
          this._leaderTabId = msg.tabId;
          this._resetLeaderWatchdog();
        }
        break;
      }
    }
  }

  // ==========================================================================
  // 🏆 Leader election helpers
  // ==========================================================================

  private _announceLeader(): void {
    this._promoteToLeader();
    this._send({ type: "LEADER_ANNOUNCE", boardId: this.boardId!, tabId: this.tabId });
  }

  private _promoteToLeader(): void {
    this._isLeader    = true;
    this._leaderTabId = this.tabId;

    telemetry.log("TAB_COORDINATION", "PROMOTED_TO_LEADER", { tabId: this.tabId });
    this._onLeaderChanged?.(true);

    // Start heartbeat so followers know we're alive
    this._clearLeaderTimers();
    this._leaderHbTimer = setInterval(() => {
      if (!this._isLeader) { this._clearLeaderTimers(); return; }
      this._send({ type: "LEADER_HEARTBEAT", boardId: this.boardId!, tabId: this.tabId });
    }, LEADER_HB_MS);
  }

  private _yieldLeadership(): void {
    this._isLeader = false;
    this._clearLeaderTimers();
    this._startLeaderWatchdog();

    telemetry.log("TAB_COORDINATION", "YIELDED_LEADERSHIP", { tabId: this.tabId });
    this._onLeaderChanged?.(false);
  }

  private _startLeaderWatchdog(): void {
    this._resetLeaderWatchdog();
  }

  private _resetLeaderWatchdog(): void {
    if (this._leaderWatchdog !== null) clearTimeout(this._leaderWatchdog);
    this._leaderWatchdog = setTimeout(() => {
      // No heartbeat within timeout → self-promote
      if (!this._isLeader) this._announceLeader();
    }, LEADER_TIMEOUT_MS);
  }

  private _clearLeaderTimers(): void {
    if (this._leaderHbTimer  !== null) { clearInterval(this._leaderHbTimer);  this._leaderHbTimer  = null; }
    if (this._leaderWatchdog !== null) { clearTimeout(this._leaderWatchdog);  this._leaderWatchdog = null; }
  }

  // ==========================================================================
  // 📤 Send helper
  // ==========================================================================

  private _send(msg: TabMessage): void {
    if (!this.channel) return;
    try {
      this.channel.postMessage(msg);
    } catch (err) {
      telemetry.log("TAB_COORDINATION", "SEND_ERROR", { error: String(err) });
    }
  }
}

// ============================================================================
// 🌍 Singleton
// ============================================================================

export const tabCoordination = new TabCoordination();
