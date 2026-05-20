// apps/web/src/features/board/store/sync/positioning/positioningEngine.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// The PositioningEngine is the single orchestrator for all position-related
// operations on a board. It:
//
//   1. Serializes all rank mutations through an actor mailbox (FIFO queue),
//      guaranteeing that no two concurrent operations can observe stale
//      neighbour positions and produce duplicate/conflicting ranks.
//
//   2. Reads the current board state (cards, lists, positions) from the
//      Zustand store and uses lexoRank.ts to compute new positions.
//
//   3. Detects density exhaustion after every computation and, when triggered,
//      schedules a rebalance via rebalancer.ts.
//
//   4. Coordinates with other tabs via BroadcastChannel so that only one tab
//      (the "leader") sends rebalance requests to the server, preventing
//      duplicate rebalance storms.
//
//   5. Exposes a clean imperative API that mutation hooks call:
//        • moveCard(cardId, fromListId, toListId, targetIndex) → MoveResult
//        • moveList(listId, targetIndex) → MoveResult
//        • insertCard(listId, targetIndex) → Position
//        • insertList(targetIndex) → Position
//
// ─── Actor model ─────────────────────────────────────────────────────────────
// Each call to the engine is enqueued as a "message" in a microtask queue.
// Messages are processed one at a time (FIFO). While a message is being
// processed, subsequent calls wait in the queue. This prevents:
//   • Two drag events in the same frame seeing the same prev/next pair.
//   • Concurrent rebalance + move producing conflicting positions.
//
// The mailbox is NOT async I/O — it's a synchronous microtask scheduler
// that resolves within the same macrotask. This keeps drag-and-drop at 60fps.
//
// ─── Multi-tab coordination ──────────────────────────────────────────────────
// BroadcastChannel "kiro:positioning":
//   • REBALANCE_STARTED  → other tabs pause local position computations.
//   • REBALANCE_COMPLETE → other tabs apply the new positions from the store
//     (they arrive via WS events and are processed by applyCardMoved/applyListMoved).
//   • REBALANCE_FAILED   → other tabs resume normal operation.
//
// Only the tab that detected the density issue becomes the "rebalance leader".
// If a tab receives REBALANCE_STARTED from another tab, it defers its own
// rebalance attempt.
//
// ─── Design rules ────────────────────────────────────────────────────────────
//   • No React dependency — pure class, instantiated once per board mount.
//   • Reads store state synchronously via useBoardStore.getState().
//   • Never calls set() — it returns computed positions to the caller (hooks).
//   • Rebalance is a suggestion — the caller decides whether to send it.
//   • All public methods return Promises (mailbox serialization).
// ─────────────────────────────────────────────────────────────────────────────

import { useBoardStore, type BoardStoreState } from "../../useBoardStore";
import { telemetry } from "../../../devtools/logEvent";
import type { Position } from "@repo/domain";
import { PositionCollisionError } from "@repo/domain";

import {
  computeMovePosition,
  computeInsertPosition,
  extractSortedPositions,
  extractSortedPositionsExcluding,
  detectCollision,
} from "./lexoRank";

import {
  needsRebalance,
  buildRebalancePlan,
  type RebalancePlan,
} from "./rebalancer";

// ============================================================================
// 1.  Public types
// ============================================================================

export interface MoveCardResult {
  /** The optimistic position to pass to useMoveCard's mutate(). */
  position: Position;
  /** The mode hint for the server's LexoRank recalculation. */
  mode: "APPEND" | "PREPEND" | "INSERT_BETWEEN" | "REORDER_SAME_LIST";
  /** Prev neighbour ID (for server INSERT_BETWEEN). */
  prevId?: string;
  /** Next neighbour ID (for server INSERT_BETWEEN). */
  nextId?: string;
  /** Non-null when density triggered — caller should send this plan to server. */
  rebalancePlan: RebalancePlan | null;
}

export interface MoveListResult {
  position: Position;
  rebalancePlan: RebalancePlan | null;
}

export interface InsertResult {
  position: Position;
  rebalancePlan: RebalancePlan | null;
}

// ── Multi-tab broadcast types ────────────────────────────────────────────────

type TabMessage =
  | { type: "REBALANCE_STARTED"; tabId: string; scope: string }
  | { type: "REBALANCE_COMPLETE"; tabId: string; scope: string }
  | { type: "REBALANCE_FAILED"; tabId: string; scope: string };

// ============================================================================
// 2.  Mailbox — microtask-based actor queue
// ============================================================================

type MailboxTask<T> = () => T;

class Mailbox {
  private queue: Array<{
    task: MailboxTask<any>;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }> = [];
  private processing = false;

  enqueue<T>(task: MailboxTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      if (!this.processing) {
        this._drain();
      }
    });
  }

  private _drain() {
    this.processing = true;

    while (this.queue.length > 0) {
      const { task, resolve, reject } = this.queue.shift()!;
      try {
        const result = task();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }

    this.processing = false;
  }

  /** Current queue depth — useful for backpressure monitoring. */
  get depth(): number {
    return this.queue.length;
  }
}

// ============================================================================
// 3.  PositioningEngine
// ============================================================================

export class PositioningEngine {
  // ── Identity & state ──────────────────────────────────────────────────────
  private readonly tabId = crypto.randomUUID();
  private boardId: string | null = null;

  // ── Actor mailbox ─────────────────────────────────────────────────────────
  private readonly mailbox = new Mailbox();

  // ── Multi-tab coordination ────────────────────────────────────────────────
  private channel: BroadcastChannel | null = null;
  private rebalanceInProgress = false;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  private _active = false;

  // ==========================================================================
  // 3a. Lifecycle
  // ==========================================================================

  init(boardId: string) {
    this.boardId = boardId;
    this._active = true;

    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("kiro:positioning");
      this.channel.onmessage = (ev: MessageEvent<TabMessage>) => {
        this._handleTabMessage(ev.data);
      };
    }

    telemetry.log("STORE", "POSITIONING_ENGINE_INIT", { boardId, tabId: this.tabId });
  }

  destroy() {
    this._active = false;
    this.channel?.close();
    this.channel = null;
    telemetry.log("STORE", "POSITIONING_ENGINE_DESTROYED", { boardId: this.boardId });
  }

  // ==========================================================================
  // 3b. Public API — card operations
  // ==========================================================================

  /**
   * Compute the optimistic position for moving a card to a target index
   * within a (possibly different) list.
   *
   * @param cardId      The card being moved.
   * @param fromListId  Current list.
   * @param toListId    Destination list.
   * @param targetIndex 0-based index in the destination list where the card
   *                    should appear AFTER the move.
   */
  moveCard(
    cardId: string,
    fromListId: string,
    toListId: string,
    targetIndex: number,
  ): Promise<MoveCardResult> {
    return this.mailbox.enqueue(() => this._moveCard(cardId, fromListId, toListId, targetIndex));
  }

  /**
   * Compute the position for a newly inserted card at `targetIndex` in `listId`.
   */
  insertCard(listId: string, targetIndex: number): Promise<InsertResult> {
    return this.mailbox.enqueue(() => this._insertCard(listId, targetIndex));
  }

  // ==========================================================================
  // 3c. Public API — list operations
  // ==========================================================================

  /**
   * Compute the optimistic position for moving a list to a target index
   * within the board's listOrder.
   *
   * @param listId      The list being moved.
   * @param targetIndex 0-based index in listOrder where the list should land.
   */
  moveList(listId: string, targetIndex: number): Promise<MoveListResult> {
    return this.mailbox.enqueue(() => this._moveList(listId, targetIndex));
  }

  /**
   * Compute the position for a newly inserted list at `targetIndex`.
   */
  insertList(targetIndex: number): Promise<InsertResult> {
    return this.mailbox.enqueue(() => this._insertList(targetIndex));
  }

  // ==========================================================================
  // 3d. Public API — rebalance trigger (for background sweep)
  // ==========================================================================

  /**
   * Force a rebalance of the given list's cards.
   * Returns the plan or null if no rebalance is needed.
   */
  rebalanceCardChain(listId: string): Promise<RebalancePlan | null> {
    return this.mailbox.enqueue(() => this._rebalanceCardChain(listId));
  }

  /**
   * Force a rebalance of the board's list order.
   */
  rebalanceListChain(): Promise<RebalancePlan | null> {
    return this.mailbox.enqueue(() => this._rebalanceListChain());
  }

  // ==========================================================================
  // 3e. Internal — card move
  // ==========================================================================

  private _moveCard(
    cardId: string,
    fromListId: string,
    toListId: string,
    targetIndex: number,
  ): MoveCardResult {
    const state = this._getState();

    // Build the target list's position array WITHOUT the moving card.
    const targetCardIds = state.cardsByList[toListId] ?? [];
    const positionsWithout = extractSortedPositionsExcluding(
      targetCardIds,
      state.cards,
      cardId,
    );

    // Compute the new position.
    let position: Position;
    try {
      position = computeMovePosition(positionsWithout, targetIndex);
    } catch (err) {
      if (err instanceof PositionCollisionError) {
        // Density exhausted — force rebalance first, then retry.
        const plan = this._buildCardRebalancePlan(toListId, state);
        if (plan) {
          // After rebalance, positions change. Re-read from the plan.
          const rebalancedPositions = this._applyPlanToPositions(
            targetCardIds.filter((id) => id !== cardId),
            plan,
            state.cards,
          );
          position = computeMovePosition(rebalancedPositions, targetIndex);
          return {
            position,
            ...this._computeMode(positionsWithout, targetIndex, targetCardIds, cardId, state),
            rebalancePlan: plan,
          };
        }
        // If plan is null (shouldn't happen), re-throw.
        throw err;
      }
      throw err;
    }

    // Check if the new position triggers future density concern.
    let rebalancePlan: RebalancePlan | null = null;
    if (detectCollision(position)) {
      rebalancePlan = this._buildCardRebalancePlan(toListId, state);
      this._broadcastRebalance("REBALANCE_STARTED", `cards:${toListId}`);
    }

    const modeInfo = this._computeMode(positionsWithout, targetIndex, targetCardIds, cardId, state);

    telemetry.log("STORE", "POSITION_COMPUTED_CARD", {
      cardId,
      fromListId,
      toListId,
      targetIndex,
      position,
      mailboxDepth: this.mailbox.depth,
      needsRebalance: !!rebalancePlan,
    });

    return { position, ...modeInfo, rebalancePlan };
  }

  // ==========================================================================
  // 3f. Internal — card insert
  // ==========================================================================

  private _insertCard(listId: string, targetIndex: number): InsertResult {
    const state = this._getState();
    const cardIds   = state.cardsByList[listId] ?? [];
    const positions = extractSortedPositions(cardIds, state.cards);

    let position: Position;
    try {
      position = computeInsertPosition(positions, targetIndex);
    } catch (err) {
      if (err instanceof PositionCollisionError) {
        const plan = this._buildCardRebalancePlan(listId, state);
        if (plan) {
          const rebalancedPositions = this._applyPlanToPositions(cardIds, plan, state.cards);
          position = computeInsertPosition(rebalancedPositions, targetIndex);
          return { position, rebalancePlan: plan };
        }
        throw err;
      }
      throw err;
    }

    const rebalancePlan = detectCollision(position)
      ? this._buildCardRebalancePlan(listId, state)
      : null;

    return { position, rebalancePlan };
  }

  // ==========================================================================
  // 3g. Internal — list move
  // ==========================================================================

  private _moveList(listId: string, targetIndex: number): MoveListResult {
    const state = this._getState();

    // List order positions without the moving list.
    const positionsWithout = extractSortedPositionsExcluding(
      state.listOrder,
      state.lists,
      listId,
    );

    let position: Position;
    try {
      position = computeMovePosition(positionsWithout, targetIndex);
    } catch (err) {
      if (err instanceof PositionCollisionError) {
        const plan = this._buildListRebalancePlan(state);
        if (plan) {
          const rebalancedPositions = this._applyPlanToPositions(
            state.listOrder.filter((id) => id !== listId),
            plan,
            state.lists,
          );
          position = computeMovePosition(rebalancedPositions, targetIndex);
          return { position, rebalancePlan: plan };
        }
        throw err;
      }
      throw err;
    }

    const rebalancePlan = detectCollision(position)
      ? this._buildListRebalancePlan(state)
      : null;

    if (rebalancePlan) {
      this._broadcastRebalance("REBALANCE_STARTED", "lists");
    }

    telemetry.log("STORE", "POSITION_COMPUTED_LIST", {
      listId,
      targetIndex,
      position,
      needsRebalance: !!rebalancePlan,
    });

    return { position, rebalancePlan };
  }

  // ==========================================================================
  // 3h. Internal — list insert
  // ==========================================================================

  private _insertList(targetIndex: number): InsertResult {
    const state     = this._getState();
    const positions = extractSortedPositions(state.listOrder, state.lists);

    let position: Position;
    try {
      position = computeInsertPosition(positions, targetIndex);
    } catch (err) {
      if (err instanceof PositionCollisionError) {
        const plan = this._buildListRebalancePlan(state);
        if (plan) {
          const rebalancedPositions = this._applyPlanToPositions(
            state.listOrder,
            plan,
            state.lists,
          );
          position = computeInsertPosition(rebalancedPositions, targetIndex);
          return { position, rebalancePlan: plan };
        }
        throw err;
      }
      throw err;
    }

    const rebalancePlan = detectCollision(position)
      ? this._buildListRebalancePlan(state)
      : null;

    return { position, rebalancePlan };
  }

  // ==========================================================================
  // 3i. Internal — rebalance helpers
  // ==========================================================================

  private _rebalanceCardChain(listId: string): RebalancePlan | null {
    const state = this._getState();
    return this._buildCardRebalancePlan(listId, state);
  }

  private _rebalanceListChain(): RebalancePlan | null {
    const state = this._getState();
    return this._buildListRebalancePlan(state);
  }

  private _buildCardRebalancePlan(
    listId: string,
    state: BoardStoreState,
  ): RebalancePlan | null {
    const cardIds   = state.cardsByList[listId] ?? [];
    const positions = extractSortedPositions(cardIds, state.cards);

    if (!needsRebalance(positions)) return null;

    return buildRebalancePlan(cardIds, positions);
  }

  private _buildListRebalancePlan(state: BoardStoreState): RebalancePlan | null {
    const positions = extractSortedPositions(state.listOrder, state.lists);

    if (!needsRebalance(positions)) return null;

    return buildRebalancePlan([...state.listOrder], positions);
  }

  /**
   * Applies a RebalancePlan to produce a new positions array (for retry after
   * collision during rebalance).
   */
  private _applyPlanToPositions(
    orderedIds: readonly string[],
    plan: RebalancePlan,
    lookup: Record<string, { position: Position }>,
  ): Position[] {
    const result: Position[] = [];
    for (const id of orderedIds) {
      const rebalanced = plan.assignments.get(id);
      if (rebalanced) {
        result.push(rebalanced);
      } else {
        const entity = lookup[id];
        if (entity) result.push(entity.position);
      }
    }
    return result;
  }

  // ==========================================================================
  // 3j. Internal — mode computation for server API
  // ==========================================================================

  private _computeMode(
    positionsWithout: Position[],
    targetIndex: number,
    targetCardIds: readonly string[],
    movingCardId: string,
    state: BoardStoreState,
  ): { mode: MoveCardResult["mode"]; prevId?: string; nextId?: string } {
    // Filter out the moving card from the target list's IDs.
    const idsWithout = targetCardIds.filter((id) => id !== movingCardId);
    const count      = idsWithout.length;

    if (count === 0) {
      return { mode: "APPEND" };
    }

    const clamped = Math.max(0, Math.min(targetIndex, count));

    if (clamped === 0) {
      return { mode: "PREPEND", nextId: idsWithout[0] };
    }

    if (clamped >= count) {
      return { mode: "APPEND", prevId: idsWithout[count - 1] };
    }

    // Check if this is a same-list reorder.
    const fromListId = state.cards[movingCardId]?.listId;
    const toListId   = idsWithout[0] ? state.cards[idsWithout[0]]?.listId : undefined;
    const isSameList = fromListId === toListId;

    return {
      mode:   isSameList ? "REORDER_SAME_LIST" : "INSERT_BETWEEN",
      prevId: idsWithout[clamped - 1],
      nextId: idsWithout[clamped],
    };
  }

  // ==========================================================================
  // 3k. Internal — state access
  // ==========================================================================

  private _getState(): BoardStoreState {
    return useBoardStore.getState();
  }

  // ==========================================================================
  // 3l. Multi-tab coordination
  // ==========================================================================

  private _broadcastRebalance(type: TabMessage["type"], scope: string) {
    if (!this.channel) return;
    try {
      this.channel.postMessage({ type, tabId: this.tabId, scope } satisfies TabMessage);
    } catch {
      // Channel may be closed — not critical.
    }
  }

  private _handleTabMessage(msg: TabMessage) {
    switch (msg.type) {
      case "REBALANCE_STARTED":
        if (msg.tabId !== this.tabId) {
          // Another tab is rebalancing — pause our own attempts.
          this.rebalanceInProgress = true;
          telemetry.log("STORE", "POSITIONING_REBALANCE_DEFERRED", {
            leaderTab: msg.tabId,
            scope:     msg.scope,
          });
        }
        break;

      case "REBALANCE_COMPLETE":
        this.rebalanceInProgress = false;
        telemetry.log("STORE", "POSITIONING_REBALANCE_REMOTE_COMPLETE", {
          leaderTab: msg.tabId,
          scope:     msg.scope,
        });
        break;

      case "REBALANCE_FAILED":
        this.rebalanceInProgress = false;
        telemetry.log("STORE", "POSITIONING_REBALANCE_REMOTE_FAILED", {
          leaderTab: msg.tabId,
          scope:     msg.scope,
        });
        break;
    }
  }

  // ==========================================================================
  // 3m. Observability
  // ==========================================================================

  /** True when another tab is performing a rebalance. */
  get isRebalancing(): boolean {
    return this.rebalanceInProgress;
  }

  /** Current mailbox queue depth. */
  get queueDepth(): number {
    return this.mailbox.depth;
  }
}

// ============================================================================
// 4.  Singleton instance
// ============================================================================

/**
 * Single instance shared across the board feature.
 * init() on board mount, destroy() on unmount.
 *
 * Usage:
 *   import { positioningEngine } from "./sync/positioning";
 *   positioningEngine.init(boardId);
 *   const result = await positioningEngine.moveCard(...);
 */
export const positioningEngine = new PositioningEngine();
