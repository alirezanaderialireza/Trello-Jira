// apps/web/src/features/board/store/useBoardStore.ts

import { create } from "zustand";
import { telemetry } from "../devtools/logEvent";

import type { AppDomainEvent } from "@repo/domain";
import type { ClientEventEnvelope } from "./event-application/types";
import type { ReducerContext } from "./event-application/context";
import { applyEvent as dispatcherApplyEvent } from "./event-application/dispatcher";

// 🌟 وارد کردن موتور تطبیق که در فایل مجزا ساختیم
import { reconcileIncomingEvent } from "./event-application/reconcileIncomingEvent";

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
  // ==========================================================================
  // Projections
  // ==========================================================================

  lists: Record<string, ListDto>;

  cards: Record<string, CardDto>;

  cardsByList: Record<string, string[]>;

  listOrder: string[];

  // ==========================================================================
  // Sync Meta & Transactions (Phase 2.5)
  // ==========================================================================

  boardSequence: string;

  bufferedEvents: Record<string, WsEvent>;

  syncStatus: SyncStatus;

  pendingMutations: Record<string, PendingMutation>;
}

// ============================================================================
// ⚙️ ACTIONS
// ============================================================================

export interface BoardStoreActions {
  // ==========================================================================
  // Core Event Machine
  // ==========================================================================

  initBoard: (
    listsData: (ListDto & { cards: CardDto[] })[],
    sequence: string
  ) => void;

  applyEvent: (
    envelope: ClientEventEnvelope,
    context: ReducerContext
  ) => void;

  applyWebsocketEvent: (event: WsEvent) => void;

  // ==========================================================================
  // Transaction Management (Phase 2.5)
  // ==========================================================================

  registerPendingMutation: (mutation: PendingMutation) => void;
  resolvePendingMutation: (correlationId: string) => void;
  updatePendingMutationStatus: (correlationId: string, status: PendingMutation["status"]) => void;
  restoreSnapshot: (snapshot: BoardSnapshot) => void;
  gcPendingMutations: () => void;

  // ==========================================================================
  // Legacy Bridge Actions
  // ==========================================================================

  addCard: (card: Partial<CardDto>) => void;

  deleteCard: (cardId: string) => void;

  replaceCard: (
    tempId: string,
    serverCard: Partial<CardDto>
  ) => void;

  updateCard: (
    cardId: string,
    changes: Partial<CardDto>
  ) => void;

  addList: (list: Partial<ListDto>) => void;

  deleteList: (listId: string) => void;

  replaceList: (
    tempId: string,
    serverList: Partial<ListDto>
  ) => void;

  moveCard: (
    cardId: string,
    fromListId: string,
    toListId: string,
    fromIndex: number,
    toIndex: number
  ) => void;

  moveList: (
    fromIndex: number,
    toIndex: number
  ) => void;
}

// ============================================================================
// 🧠 FULL STORE TYPE
// ============================================================================

export type BoardState =
  BoardStoreState &
  BoardStoreActions;

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
          a.position.localeCompare(b.position) ||
          a.id.localeCompare(b.id)
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
            a.position.localeCompare(b.position) ||
            a.id.localeCompare(b.id)
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
    set((state) => {
      return dispatcherApplyEvent(
        state,
        envelope,
        context
      );
    }),

  // ==========================================================================
  // 🛠️ Transaction Actions (Phase 2.5)
  // ==========================================================================

  registerPendingMutation: (mutation) => set((state) => ({
    pendingMutations: { ...state.pendingMutations, [mutation.correlationId]: mutation }
  })),

  resolvePendingMutation: (correlationId) => set((state) => {
    const nextPending = { ...state.pendingMutations };
    delete nextPending[correlationId];
    return { pendingMutations: nextPending };
  }),

  updatePendingMutationStatus: (correlationId, status) => set((state) => {
    const mutation = state.pendingMutations[correlationId];
    if (!mutation) return state;
    return {
      pendingMutations: {
        ...state.pendingMutations,
        [correlationId]: { ...mutation, status }
      }
    };
  }),

  restoreSnapshot: (snapshot) => set((state) => {
    const nextCards = { ...state.cards };
    const nextLists = { ...state.lists };
    const nextCardsByList = { ...state.cardsByList };

    if (snapshot.cards) {
    Object.entries(snapshot.cards).forEach(([id, snapCard]) => {
      const currentCard = state.cards[id];
      
      if (currentCard && currentCard.revision > snapCard.revision) {
        // 🌟 محل قرارگیری سنسور: رول‌بک به ورژن قدیمی‌تر انجام نشد
        telemetry.log(
          "SNAPSHOT_MANAGER",
          "ROLLBACK_SKIPPED",
          { entityId: id, currentRevision: currentCard.revision, snapshotRevision: snapCard.revision, reason: "stale_protection" }
        );
        return; // از این مورد عبور کن
      }
      // در غیر این صورت رول‌بک انجام شود...
    });
  }

    if (snapshot.lists) {
      Object.entries(snapshot.lists).forEach(([id, snapList]) => {
        if (!state.lists[id] || state.lists[id].revision <= snapList.revision) {
          nextLists[id] = snapList;
        }
      });
    }

    if (snapshot.cardsByList) {
      Object.entries(snapshot.cardsByList).forEach(([id, snapArr]) => {
        const currentList = state.lists[id];
        const snapList = snapshot.lists?.[id];
        if (!currentList || (snapList && currentList.revision <= snapList.revision)) {
          nextCardsByList[id] = [...snapArr];
        }
      });
    }

    return {
      cards: nextCards,
      lists: nextLists,
      cardsByList: nextCardsByList,
      listOrder: snapshot.listOrder ? [...snapshot.listOrder] : state.listOrder,
    };
  }),

  gcPendingMutations: () => set((state) => {
    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;
    const nextPending = { ...state.pendingMutations };
    let changed = false;

    Object.entries(nextPending).forEach(([id, mutation]) => {
      if (now - mutation.createdAt > FIVE_MINUTES && mutation.status !== "pending") {
        delete nextPending[id];
        changed = true;
      }
    });

    return changed ? { pendingMutations: nextPending } : state;
  }),

  // ==========================================================================
  // 📡 WebSocket Orchestrator (استفاده از فایل استخراج شده)
  // ==========================================================================

  applyWebsocketEvent: (wsEvent) =>
    set((state) => {
      const stateUpdates = reconcileIncomingEvent(state, wsEvent);
      // اگر تغییری نیاز بود آن را اعمال کن، در غیر این صورت استیت قبلی را برگردان
      return stateUpdates ? stateUpdates : state;
    }),

  // ==========================================================================
  // 🌉 LEGACY BRIDGE ACTIONS
  // ==========================================================================

  addCard: (card) =>
    set((state) => {
      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),

          type: "card.created",

          version: card.revision ?? 0,

          occurredAt: new Date().toISOString(),

          aggregateId: card.id ?? "",

          aggregateType: "card",

          payload: {
            cardId: card.id,
            listId: card.listId,
            title: card.title,
            position: card.position,
          },
        } as AppDomainEvent,

        optimistic: card.isOptimistic,
      };

      return dispatcherApplyEvent(
        state,
        envelope,
        { mode: "live" }
      );
    }),

  moveCard: (
    cardId,
    fromListId,
    toListId
  ) =>
    set((state) => {
      const currentCard =
        state.cards[cardId];

      if (!currentCard) {
        return state;
      }

      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),

          type: "card.moved",

          version:
            currentCard.revision + 1,

          occurredAt:
            new Date().toISOString(),

          aggregateId: cardId,

          aggregateType: "card",

          payload: {
            cardId,
            fromListId,
            toListId,
            newPosition:
              currentCard.position + "V",
          },
        } as AppDomainEvent,

        optimistic: true,
      };

      return dispatcherApplyEvent(
        state,
        envelope,
        { mode: "live" }
      );
    }),

  updateCard: (cardId, changes) =>
    set((state) => {
      const currentCard =
        state.cards[cardId];

      if (!currentCard) {
        return state;
      }

      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),

          type: "card.updated",

          version:
            currentCard.revision + 1,

          occurredAt:
            new Date().toISOString(),

          aggregateId: cardId,

          aggregateType: "card",

          payload: {
            cardId,
            changes,
          },
        } as AppDomainEvent,

        optimistic: true,
      };

      return dispatcherApplyEvent(
        state,
        envelope,
        { mode: "live" }
      );
    }),

  replaceCard: (tempId, serverCard) => set((state) => {
  const envelope: ClientEventEnvelope = {
    event: {
      id: crypto.randomUUID(),

      type: "card.updated",

      version: serverCard.revision ?? 0,

      occurredAt: new Date().toISOString(),

      aggregateId: tempId,

      aggregateType: "card",

      payload: {
        boardId: serverCard.boardId,

        cardId: tempId,

        changes: {
          ...serverCard,
          id: serverCard.id,
          isOptimistic: false,
        },
      },
    } as AppDomainEvent,

    optimistic: false,
  };

  return dispatcherApplyEvent(
    state,
    envelope,
    { mode: "live" }
  );
}),

  deleteCard: (cardId) =>
    set((state) => {
      const currentCard =
        state.cards[cardId];

      if (!currentCard) {
        return state;
      }

      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),

          type: "card.deleted",

          version:
            currentCard.revision + 1,

          occurredAt:
            new Date().toISOString(),

          aggregateId: cardId,

          aggregateType: "card",

          payload: {
            cardId,
          },
        } as AppDomainEvent,

        optimistic: true,
      };

      return dispatcherApplyEvent(
        state,
        envelope,
        { mode: "live" }
      );
    }),

  addList: (list) =>
    set((state) => {
      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),

          type: "list.created",

          version: list.revision ?? 0,

          occurredAt:
            new Date().toISOString(),

          aggregateId: list.id ?? "",

          aggregateType: "list",

          payload: {
            listId: list.id,
            title: list.title,
            position: list.position,
          },
        } as AppDomainEvent,

        optimistic: true,
      };

      return dispatcherApplyEvent(
        state,
        envelope,
        { mode: "live" }
      );
    }),

  replaceList: (
    tempId,
    serverList
  ) =>
    set((state) => {
      const existing =
        state.lists[tempId];

      if (!existing) {
        return state;
      }

      return {
        lists: {
          ...state.lists,

          [serverList.id as string]: {
            ...existing,

            ...serverList,

            isOptimistic: false,
          },
        },
      };
    }),

  deleteList: (listId) =>
    set((state) => {
      const { [listId]: _, ...remainingLists } =
        state.lists;

      const {
        [listId]: __,
        ...remainingCardsByList
      } = state.cardsByList;

      return {
        lists: remainingLists,

        cardsByList:
          remainingCardsByList,

        listOrder:
          state.listOrder.filter(
            (id) => id !== listId
          ),
      };
    }),

  moveList: (fromIndex, toIndex) =>
    set((state) => {
      const listId =
        state.listOrder[fromIndex];

      if (!listId) {
        return state;
      }

      const list =
        state.lists[listId];

      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),

          type: "list.moved",

          version:
            list.revision + 1,

          occurredAt:
            new Date().toISOString(),

          aggregateId: listId,

          aggregateType: "list",

          payload: {
            listId,

            newPosition:
              list.position + "V",
          },
        } as AppDomainEvent,

        optimistic: true,
      };

      return dispatcherApplyEvent(
        state,
        envelope,
        { mode: "live" }
      );
    }),
}));