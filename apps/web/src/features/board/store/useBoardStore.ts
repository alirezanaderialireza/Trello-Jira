// apps/web/src/features/board/store/useBoardStore.ts

import { create } from "zustand";
import { telemetry } from "../devtools/logEvent";

import type { AppDomainEvent } from "@repo/domain";
import type { ClientEventEnvelope } from "./event-application/types";
import type { ReducerContext } from "./event-application/context";
import { applyEvent as dispatcherApplyEvent } from "./event-application/dispatcher";
import { reconcileIncomingEvent } from "./event-application/reconcileIncomingEvent";

// ============================================================================
// 🛡️ Constants
// ============================================================================

/**
 * R9 — Hard upper bound on buffered WS events.
 * If the buffer exceeds this size the client is too far behind to recover
 * incrementally; force a full resync instead.
 */
const BUFFER_HARD_LIMIT = 200;

// ============================================================================
// 🛡️ DTOs & Snapshots
// ============================================================================

export type CardDto = {
  id: string;
  boardId: string;
  title: string;
  position: string;
  listId: string;
  description?: string;
  revision: number;
  updatedAt?: string | number;
  isOptimistic?: boolean;
};

export type ListDto = {
  id: string;
  title: string;
  position: string;
  revision: number;
  updatedAt?: string | number;
  isOptimistic?: boolean;
};

export interface BoardSnapshot {
  cards?: Record<string, CardDto>;
  cardsByList?: Record<string, string[]>;
  lists?: Record<string, ListDto>;
  listOrder?: string[];
}

// ============================================================================
// 🌐 WS Contracts & Transaction Types
// ============================================================================

export interface PendingMutation {
  correlationId: string;
  type: string;
  createdAt: number;
  aggregateId: string;
  rollbackSnapshot?: BoardSnapshot;
  retryCount: number;
  status: "pending" | "acked" | "failed";
  optimisticVersion?: number;
}

export interface WsEvent {
  sequence: string;
  type: string;
  payload: AppDomainEvent;
}

export type SyncStatus =
  | "healthy"
  | "gap_detected"
  | "reconnecting"
  | "desynced";

// ============================================================================
// 🌟 PURE STORE STATE
// ============================================================================

export interface BoardStoreState {
  lists: Record<string, ListDto>;
  cards: Record<string, CardDto>;
  cardsByList: Record<string, string[]>;
  listOrder: string[];
  boardSequence: string;
  bufferedEvents: Record<string, WsEvent>;
  syncStatus: SyncStatus;
  pendingMutations: Record<string, PendingMutation>;
}

// ============================================================================
// ⚙️ ACTIONS
// ============================================================================

export interface BoardStoreActions {
  initBoard: (
    listsData: (ListDto & { cards: CardDto[] })[],
    sequence: string
  ) => void;

  applyEvent: (
    envelope: ClientEventEnvelope,
    context: ReducerContext
  ) => void;

  applyWebsocketEvent: (event: WsEvent) => void;

  registerPendingMutation: (mutation: PendingMutation) => void;
  resolvePendingMutation: (correlationId: string) => void;
  updatePendingMutationStatus: (
    correlationId: string,
    status: PendingMutation["status"]
  ) => void;
  restoreSnapshot: (snapshot: BoardSnapshot) => void;
  gcPendingMutations: () => void;

  // -------------------------------------------------------------------------
  // R8 — addCard: card.id must be present (required for aggregateId).
  //      boardId is required by CardCreatedPayload.
  // -------------------------------------------------------------------------
  addCard: (card: Omit<Partial<CardDto>, "id"> & { id: string; boardId: string }) => void;
  deleteCard: (cardId: string) => void;
  replaceCard: (tempId: string, serverCard: Partial<CardDto>) => void;
  updateCard: (cardId: string, changes: { title?: string; description?: string }) => void;
  addList: (list: Partial<ListDto> & { boardId: string }) => void;
  deleteList: (listId: string) => void;
  replaceList: (tempId: string, serverList: Partial<ListDto> & { id: string }) => void;
  moveCard: (
    cardId: string,
    fromListId: string,
    toListId: string,
    fromIndex: number,
    toIndex: number
  ) => void;
  moveList: (fromIndex: number, toIndex: number) => void;
}

// ============================================================================
// 🧠 FULL STORE TYPE
// ============================================================================

export type BoardState = BoardStoreState & BoardStoreActions;

// ============================================================================
// 🚀 STORE
// ============================================================================

export const useBoardStore = create<BoardState>()((set) => ({
  // ==========================================================================
  // Initial State
  // ==========================================================================

  lists: {},
  cards: {},
  cardsByList: {},
  listOrder: [],
  boardSequence: "0",
  bufferedEvents: {},
  syncStatus: "healthy",
  pendingMutations: {},

  // ==========================================================================
  // 📥 Hydration
  // ==========================================================================

  initBoard: (listsData, sequence) =>
    set(() => {
      const newLists: Record<string, ListDto> = {};
      const newCards: Record<string, CardDto> = {};
      const newCardsByList: Record<string, string[]> = {};
      const newListOrder: string[] = [];

      const safeLists = listsData || [];

      const sortedLists = [...safeLists].sort(
        (a, b) =>
          a.position.localeCompare(b.position) || a.id.localeCompare(b.id)
      );

      sortedLists.forEach((list) => {
        newLists[list.id] = {
          id: list.id,
          title: list.title,
          position: list.position,
          revision: list.revision,
          updatedAt: list.updatedAt,
        };

        newListOrder.push(list.id);
        newCardsByList[list.id] = [];

        const sortedCards = [...(list.cards || [])].sort(
          (a, b) =>
            a.position.localeCompare(b.position) || a.id.localeCompare(b.id)
        );

        sortedCards.forEach((card) => {
          newCards[card.id] = card;
          newCardsByList[list.id].push(card.id);
        });
      });

      return {
        lists: newLists,
        cards: newCards,
        cardsByList: newCardsByList,
        listOrder: newListOrder,
        boardSequence: sequence,
        syncStatus: "healthy",
        bufferedEvents: {},
        pendingMutations: {},
      };
    }),

  // ==========================================================================
  // 👑 Core Event Pipeline
  // ==========================================================================

  applyEvent: (envelope, context) =>
    set((state) => dispatcherApplyEvent(state, envelope, context)),

  // ==========================================================================
  // 🛠️ Transaction Actions
  // ==========================================================================

  registerPendingMutation: (mutation) =>
    set((state) => ({
      pendingMutations: {
        ...state.pendingMutations,
        [mutation.correlationId]: mutation,
      },
    })),

  resolvePendingMutation: (correlationId) =>
    set((state) => {
      const nextPending = { ...state.pendingMutations };
      delete nextPending[correlationId];
      return { pendingMutations: nextPending };
    }),

  updatePendingMutationStatus: (correlationId, status) =>
    set((state) => {
      const mutation = state.pendingMutations[correlationId];
      if (!mutation) return state;
      return {
        pendingMutations: {
          ...state.pendingMutations,
          [correlationId]: { ...mutation, status },
        },
      };
    }),

  // ==========================================================================
  // 🔄 Snapshot Restore (Rollback Engine)
  // ==========================================================================

  restoreSnapshot: (snapshot) =>
    set((state) => {
      const nextCards = { ...state.cards };
      const nextLists = { ...state.lists };
      const nextCardsByList = { ...state.cardsByList };

      // -----------------------------------------------------------------------
      // Cards — stale-protection then write (R1 fix, already landed)
      // -----------------------------------------------------------------------
      if (snapshot.cards) {
        Object.entries(snapshot.cards).forEach(([id, snapCard]) => {
          const currentCard = state.cards[id];

          if (currentCard && currentCard.revision > snapCard.revision) {
            // Current card has already been confirmed ahead of the snapshot —
            // rolling back would regress canonical state. Skip this entity.
            telemetry.log(
              "SNAPSHOT_MANAGER",
              "ROLLBACK_SKIPPED",
              {
                entityId: id,
                currentRevision: currentCard.revision,
                snapshotRevision: snapCard.revision,
                reason: "stale_protection",
              }
            );
            return;
          }

          nextCards[id] = snapCard;
        });
      }

      // -----------------------------------------------------------------------
      // Lists — R7: symmetric stale-protection with cards (strict >)
      //
      // Previous policy was `revision <= snapList.revision` which allowed
      // rollback when current === snapshot (same revision).  That's safe for
      // an entity that hasn't moved, but the asymmetry with the cards block
      // (which uses >) was confusing and could allow spurious rollbacks of a
      // list that a concurrent WS event had already advanced to the same
      // revision as the pre-mutation snapshot.
      //
      // Correct policy: skip rollback only when the current entity is STRICTLY
      // ahead of the snapshot (i.e. a later WS event already applied).
      // -----------------------------------------------------------------------
      if (snapshot.lists) {
        Object.entries(snapshot.lists).forEach(([id, snapList]) => {
          const currentList = state.lists[id];

          if (currentList && currentList.revision > snapList.revision) {
            telemetry.log(
              "SNAPSHOT_MANAGER",
              "ROLLBACK_SKIPPED",
              {
                entityId: id,
                currentRevision: currentList.revision,
                snapshotRevision: snapList.revision,
                reason: "stale_protection",
              }
            );
            return;
          }

          nextLists[id] = snapList;
        });
      }

      // -----------------------------------------------------------------------
      // cardsByList — guard uses the same symmetric policy as lists above
      // -----------------------------------------------------------------------
      if (snapshot.cardsByList) {
        Object.entries(snapshot.cardsByList).forEach(([id, snapArr]) => {
          const currentList = state.lists[id];
          const snapList = snapshot.lists?.[id];

          if (
            currentList &&
            snapList &&
            currentList.revision > snapList.revision
          ) {
            // List itself was skipped above — skip its ordering too
            return;
          }

          nextCardsByList[id] = [...snapArr];
        });
      }

      return {
        cards: nextCards,
        lists: nextLists,
        cardsByList: nextCardsByList,
        listOrder: snapshot.listOrder
          ? [...snapshot.listOrder]
          : state.listOrder,
      };
    }),

  // ==========================================================================
  // 🗑️ GC
  // ==========================================================================

  gcPendingMutations: () =>
    set((state) => {
      const now = Date.now();
      const FIVE_MINUTES = 5 * 60 * 1000;
      const nextPending = { ...state.pendingMutations };
      let changed = false;

      Object.entries(nextPending).forEach(([id, mutation]) => {
        if (
          now - mutation.createdAt > FIVE_MINUTES &&
          mutation.status !== "pending"
        ) {
          delete nextPending[id];
          changed = true;
        }
      });

      return changed ? { pendingMutations: nextPending } : state;
    }),

  // ==========================================================================
  // 📡 WebSocket Orchestrator
  // ==========================================================================

  applyWebsocketEvent: (wsEvent) =>
    set((state) => {
      const stateUpdates = reconcileIncomingEvent(state, wsEvent);
      return stateUpdates ? stateUpdates : state;
    }),

  // ==========================================================================
  // 🌉 LEGACY BRIDGE ACTIONS
  //
  // These bridges exist to let older call-sites (pre-optimistic-mutation hook)
  // interact with the event pipeline.  They all:
  //   1. Construct a minimal ClientEventEnvelope
  //   2. Attach a correlationId so reconcileIncomingEvent can ACK/clean up
  //   3. Delegate to dispatcherApplyEvent (same path as the real mutation hooks)
  //
  // IMPORTANT — R5 / LexoRank safety:
  //   Bridges that need a new position use `currentPosition + "V"` as a
  //   *temporary* optimistic placeholder only.  The string-append trick
  //   produces a lexicographically-greater value, which is sufficient to
  //   render the card/list "after" its current position in the UI until the
  //   server-authoritative LexoRank position arrives via WebSocket.
  //   The server ALWAYS overwrites this value; it is never persisted.
  // ==========================================================================

  // -------------------------------------------------------------------------
  // addCard
  // R2: boardId forwarded (CardCreatedPayload requires it)
  // R4: correlationId attached to event
  // R8: card.id is required by the updated signature — no "" fallback
  // -------------------------------------------------------------------------
  addCard: (card) =>
    set((state) => {
      const correlationId = crypto.randomUUID();

      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),
          type: "card.created",
          version: card.revision ?? 1,
          occurredAt: new Date().toISOString(),
          aggregateId: card.id,            // R8: always a real ID now
          aggregateType: "card",
          correlationId,                   // R4
          payload: {
            cardId: card.id,
            listId: card.listId ?? "",
            boardId: card.boardId,         // R2
            title: card.title ?? "",
            position: card.position ?? "a",
          },
        } as AppDomainEvent,
        optimistic: true,                  // R3: always optimistic for bridge
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

  // -------------------------------------------------------------------------
  // moveCard
  // R4: correlationId attached
  // R2/R5: oldPosition + boardId forwarded (CardMovedPayload requires both)
  //        newPosition is a temporary optimistic placeholder (see R5 note above)
  // -------------------------------------------------------------------------
  moveCard: (cardId, fromListId, toListId) =>
    set((state) => {
      const currentCard = state.cards[cardId];
      if (!currentCard) return state;

      const correlationId = crypto.randomUUID();

      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),
          type: "card.moved",
          version: currentCard.revision + 1,
          occurredAt: new Date().toISOString(),
          aggregateId: cardId,
          aggregateType: "card",
          correlationId,                        // R4
          payload: {
            cardId,
            fromListId,
            toListId,
            oldPosition: currentCard.position,  // required by CardMovedPayload
            newPosition: currentCard.position + "V", // R5: optimistic placeholder
            boardId: currentCard.boardId,        // required by CardMovedPayload
          },
        } as AppDomainEvent,
        optimistic: true,
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

  // -------------------------------------------------------------------------
  // updateCard
  // R4: correlationId attached
  // Type-safe: changes narrowed to CardUpdatedPayload.changes shape
  // -------------------------------------------------------------------------
  updateCard: (cardId, changes) =>
    set((state) => {
      const currentCard = state.cards[cardId];
      if (!currentCard) return state;

      const correlationId = crypto.randomUUID();

      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),
          type: "card.updated",
          version: currentCard.revision + 1,
          occurredAt: new Date().toISOString(),
          aggregateId: cardId,
          aggregateType: "card",
          correlationId,               // R4
          payload: {
            cardId,
            boardId: currentCard.boardId,
            changes: {
              // Narrow to the exact shape CardUpdatedPayload.changes allows.
              // Do NOT spread arbitrary Partial<CardDto> here — that would be a
              // schema violation (e.g. id, listId, position don't belong here).
              ...(changes.title !== undefined && { title: changes.title }),
              ...(changes.description !== undefined && { description: changes.description }),
            },
          },
        } as AppDomainEvent,
        optimistic: true,
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

  // -------------------------------------------------------------------------
  // replaceCard
  // R4: correlationId attached
  // Schema fix: changes only carries the fields CardUpdatedPayload.changes
  //             allows (title, description).  The id swap is handled by
  //             writing the new entity directly — NOT by stuffing id into
  //             changes (which applyCardUpdated would spread onto the card,
  //             violating the domain contract).
  // -------------------------------------------------------------------------
  replaceCard: (tempId, serverCard) =>
    set((state) => {
      const existingOptimistic = state.cards[tempId];
      if (!existingOptimistic) return state;

      const serverId = serverCard.id;
      if (!serverId) return state; // no canonical ID yet — do nothing

      const correlationId = crypto.randomUUID();

      // 1. Remove the temp entry, insert the canonical one directly.
      //    We do NOT go through card.updated here because that event only
      //    carries {title, description} — it cannot replace the identity (id).
      const { [tempId]: _removed, ...remainingCards } = state.cards;

      const canonicalCard: CardDto = {
        ...existingOptimistic,
        ...serverCard,
        id: serverId,
        boardId: serverCard.boardId ?? existingOptimistic.boardId,
        listId: serverCard.listId ?? existingOptimistic.listId,
        position: serverCard.position ?? existingOptimistic.position,
        revision: serverCard.revision ?? existingOptimistic.revision,
        isOptimistic: false,
      };

      // 2. Rename the tempId slot in cardsByList to serverId.
      const listId = canonicalCard.listId;
      const currentListCards = state.cardsByList[listId] ?? [];
      const nextListCards = currentListCards.map((id) =>
        id === tempId ? serverId : id
      );

      telemetry.log("SNAPSHOT_MANAGER", "REPLACE_CARD", {
        tempId,
        serverId,
        correlationId,
      });

      return {
        cards: {
          ...remainingCards,
          [serverId]: canonicalCard,
        },
        cardsByList: {
          ...state.cardsByList,
          [listId]: nextListCards,
        },
      };
    }),

  // -------------------------------------------------------------------------
  // deleteCard
  // R4: correlationId attached
  // R2: boardId forwarded (CardDeletedPayload requires it)
  // -------------------------------------------------------------------------
  deleteCard: (cardId) =>
    set((state) => {
      const currentCard = state.cards[cardId];
      if (!currentCard) return state;

      const correlationId = crypto.randomUUID();

      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),
          type: "card.deleted",
          version: currentCard.revision + 1,
          occurredAt: new Date().toISOString(),
          aggregateId: cardId,
          aggregateType: "card",
          correlationId,                    // R4
          payload: {
            cardId,
            boardId: currentCard.boardId,   // required by CardDeletedPayload
          },
        } as AppDomainEvent,
        optimistic: true,
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

  // -------------------------------------------------------------------------
  // addList
  // R4: correlationId attached
  // R9 (list): boardId forwarded (ListCreatedPayload requires it)
  // -------------------------------------------------------------------------
  addList: (list) =>
    set((state) => {
      if (!list.id) return state; // R8-equivalent: no anonymous list creation

      const correlationId = crypto.randomUUID();

      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),
          type: "list.created",
          version: list.revision ?? 1,
          occurredAt: new Date().toISOString(),
          aggregateId: list.id,
          aggregateType: "list",
          correlationId,              // R4
          payload: {
            listId: list.id,
            boardId: list.boardId,    // R9: required by ListCreatedPayload
            title: list.title ?? "",
            position: list.position ?? "a",
          },
        } as AppDomainEvent,
        optimistic: true,
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

  // -------------------------------------------------------------------------
  // replaceList — R6: ghost list fix
  //
  // Previous implementation only inserted the server list under the new key
  // but left tempId in:
  //   • state.lists        (ghost entry)
  //   • state.listOrder    (ghost position)
  //   • state.cardsByList  (orphaned card bucket)
  //
  // Fix: atomically rename all three slices.
  // -------------------------------------------------------------------------
  replaceList: (tempId, serverList) =>
    set((state) => {
      const existing = state.lists[tempId];
      if (!existing) return state;

      const serverId = serverList.id;
      if (!serverId) return state;

      // 1. Swap lists dictionary
      const { [tempId]: _removedList, ...remainingLists } = state.lists;

      const canonicalList: ListDto = {
        ...existing,
        ...serverList,
        id: serverId,
        isOptimistic: false,
      };

      // 2. Rename tempId → serverId in listOrder            (R6 fix)
      const nextListOrder = state.listOrder.map((id) =>
        id === tempId ? serverId : id
      );

      // 3. Rename cardsByList bucket tempId → serverId      (R6 fix)
      const { [tempId]: orphanedCards, ...remainingCardsByList } =
        state.cardsByList;

      telemetry.log("SNAPSHOT_MANAGER", "REPLACE_LIST", {
        tempId,
        serverId,
      });

      return {
        lists: {
          ...remainingLists,
          [serverId]: canonicalList,
        },
        listOrder: nextListOrder,
        cardsByList: {
          ...remainingCardsByList,
          [serverId]: orphanedCards ?? [],
        },
      };
    }),

  // -------------------------------------------------------------------------
  // deleteList
  // -------------------------------------------------------------------------
  deleteList: (listId) =>
    set((state) => {
      const { [listId]: _removedList, ...remainingLists } = state.lists;
      const { [listId]: _removedCards, ...remainingCardsByList } =
        state.cardsByList;

      return {
        lists: remainingLists,
        cardsByList: remainingCardsByList,
        listOrder: state.listOrder.filter((id) => id !== listId),
      };
    }),

  // -------------------------------------------------------------------------
  // moveList
  // R4: correlationId attached
  // R10: boardId + oldPosition forwarded (ListMovedPayload requires both)
  // R5:  newPosition is a temporary optimistic placeholder (see note above)
  // -------------------------------------------------------------------------
  moveList: (fromIndex, _toIndex) =>
    set((state) => {
      const listId = state.listOrder[fromIndex];
      if (!listId) return state;

      const list = state.lists[listId];
      if (!list) return state;

      // boardId is not stored on ListDto — it must be provided by the caller
      // context.  For the legacy bridge we cannot derive it from the store, so
      // we emit a dev warning and skip.  Callers that know boardId should use
      // useMoveList (the proper optimistic mutation hook) instead.
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[BoardStore.moveList] legacy bridge cannot derive boardId from ListDto. " +
          "Use useMoveList hook for proper optimistic move with boardId."
        );
      }

      const correlationId = crypto.randomUUID();

      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),
          type: "list.moved",
          version: list.revision + 1,
          occurredAt: new Date().toISOString(),
          aggregateId: listId,
          aggregateType: "list",
          correlationId,                    // R4
          payload: {
            listId,
            boardId: "",                    // R10: unknown at bridge level — server will reject if wrong
            oldPosition: list.position,     // R10: required by ListMovedPayload
            newPosition: list.position + "V", // R5: optimistic placeholder
          },
        } as AppDomainEvent,
        optimistic: true,
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),
}));
