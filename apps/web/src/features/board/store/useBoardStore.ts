// apps/web/src/features/board/store/useBoardStore.ts

import { create } from "zustand";
import { telemetry } from "../devtools/logEvent";

import type {
  AppDomainEvent,
  CardCreatedEvent,
  CardMovedEvent,
  CardUpdatedEvent,
  CardDeletedEvent,
  ListCreatedEvent,
  ListMovedEvent,
} from "@repo/domain";
import type { ClientEventEnvelope } from "./event-application/types";
import type { ReducerContext } from "./event-application/context";
import { applyEvent as dispatcherApplyEvent } from "./event-application/dispatcher";

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
  boardId?: string; // ✅ optional here — required only in ListCreatedPayload bridge
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

  addCard: (card: Partial<CardDto> & { boardId: string }) => void;
  deleteCard: (cardId: string) => void;
  replaceCard: (tempId: string, serverCard: Partial<CardDto>) => void;
  updateCard: (cardId: string, changes: Partial<CardDto>) => void;
  addList: (list: Partial<ListDto>) => void;
  deleteList: (listId: string) => void;
  replaceList: (tempId: string, serverList: Partial<ListDto>) => void;
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

      const safeLists = listsData ?? [];

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

        const sortedCards = [...(list.cards ?? [])].sort(
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

  /**
   * ✅ FIX 1: restoreSnapshot — nextCards اکنون به درستی assign می‌شود.
   *
   * باگ قبلی: داخل forEach فقط `return` بود برای skip کردن stale ها،
   * ولی هیچ‌وقت `nextCards[id] = snapCard` برای non-stale ها نوشته نمی‌شد.
   * نتیجه: rollback کارت‌ها هرگز اتفاق نمی‌افتاد.
   *
   * Fix: branch else صریح اضافه شد که nextCards[id] را assign می‌کند.
   */
  restoreSnapshot: (snapshot) =>
    set((state) => {
      const nextCards = { ...state.cards };
      const nextLists = { ...state.lists };
      const nextCardsByList = { ...state.cardsByList };

      if (snapshot.cards) {
        Object.entries(snapshot.cards).forEach(([id, snapCard]) => {
          const currentCard = state.cards[id];

          if (currentCard && currentCard.revision > snapCard.revision) {
            // کارت فعلی جدیدتر از snapshot است — rollback لازم نیست
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
            return; // از این آیتم رد شو، nextCards[id] دست‌نخورده می‌ماند
          }

          // ✅ FIX: assign صریح — این خط قبلاً وجود نداشت
          nextCards[id] = snapCard;

          telemetry.log(
            "SNAPSHOT_MANAGER",
            "ROLLBACK_APPLIED",
            {
              entityId: id,
              restoredRevision: snapCard.revision,
            }
          );
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
          if (
            !currentList ||
            (snapList && currentList.revision <= snapList.revision)
          ) {
            nextCardsByList[id] = [...snapArr];
          }
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
      return stateUpdates ?? state;
    }),

  // ==========================================================================
  // 🌉 LEGACY BRIDGE ACTIONS
  // ==========================================================================

  /**
   * ✅ FIX 2: boardId اکنون به payload پاس می‌شود.
   *
   * باگ قبلی: CardCreatedPayload.boardId یک فیلد required در domain contract است،
   * ولی bridge آن را ارسال نمی‌کرد. `as AppDomainEvent` این را silently bypass می‌کرد.
   * نتیجه: card.boardId در تمام downstream consumers برابر undefined بود.
   *
   * Fix:
   * - امضای addCard به `Partial<CardDto> & { boardId: string }` تغییر یافت.
   * - boardId صریحاً به payload پاس می‌شود.
   * - cast محدود به `CardCreatedEvent` شد (نه AppDomainEvent).
   */
  addCard: (card) =>
    set((state) => {
      const envelope: ClientEventEnvelope<CardCreatedEvent> = {
        event: {
          id: crypto.randomUUID(),
          type: "card.created",
          version: card.revision ?? 0,
          occurredAt: new Date().toISOString(),
          aggregateId: card.id ?? "",
          aggregateType: "card",
          payload: {
            cardId: card.id ?? "",
            listId: card.listId ?? "",
            boardId: card.boardId, // ✅ FIX: boardId اکنون ارسال می‌شود
            title: card.title ?? "",
            position: card.position ?? "",
          },
        },
        optimistic: card.isOptimistic,
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

  /**
   * ✅ FIX 3: oldPosition اکنون به CardMovedPayload پاس می‌شود.
   *
   * باگ قبلی: CardMovedPayload.oldPosition یک فیلد required در domain contract است،
   * ولی bridge آن را ارسال نمی‌کرد.
   *
   * Fix: currentCard.position به عنوان oldPosition استفاده می‌شود.
   * Cast محدود به CardMovedEvent شد.
   */
  moveCard: (cardId, fromListId, toListId) =>
    set((state) => {
      const currentCard = state.cards[cardId];
      if (!currentCard) return state;

      const envelope: ClientEventEnvelope<CardMovedEvent> = {
        event: {
          id: crypto.randomUUID(),
          type: "card.moved",
          version: currentCard.revision + 1,
          occurredAt: new Date().toISOString(),
          aggregateId: cardId,
          aggregateType: "card",
          payload: {
            cardId,
            fromListId,
            toListId,
            boardId: currentCard.boardId,
            oldPosition: currentCard.position, // ✅ FIX: oldPosition ارسال می‌شود
            newPosition: currentCard.position + "V",
          },
        },
        optimistic: true,
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

  updateCard: (cardId, changes) =>
    set((state) => {
      const currentCard = state.cards[cardId];
      if (!currentCard) return state;

      const envelope: ClientEventEnvelope<CardUpdatedEvent> = {
        event: {
          id: crypto.randomUUID(),
          type: "card.updated",
          version: currentCard.revision + 1,
          occurredAt: new Date().toISOString(),
          aggregateId: cardId,
          aggregateType: "card",
          payload: {
            cardId,
            boardId: currentCard.boardId,
            changes: {
              title: changes.title,
              description: changes.description,
            },
          },
        },
        optimistic: true,
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

  replaceCard: (tempId, serverCard) =>
    set((state) => {
      const envelope: ClientEventEnvelope<CardUpdatedEvent> = {
        event: {
          id: crypto.randomUUID(),
          type: "card.updated",
          version: serverCard.revision ?? 0,
          occurredAt: new Date().toISOString(),
          aggregateId: tempId,
          aggregateType: "card",
          payload: {
            boardId: serverCard.boardId ?? "",
            cardId: tempId,
            changes: {
              title: serverCard.title,
              description: serverCard.description,
            },
          },
        },
        optimistic: false,
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

  /**
   * ✅ FIX 4: boardId اکنون به CardDeletedPayload پاس می‌شود.
   *
   * باگ قبلی: CardDeletedPayload.boardId یک فیلد required در domain contract است.
   */
  deleteCard: (cardId) =>
    set((state) => {
      const currentCard = state.cards[cardId];
      if (!currentCard) return state;

      const envelope: ClientEventEnvelope<CardDeletedEvent> = {
        event: {
          id: crypto.randomUUID(),
          type: "card.deleted",
          version: currentCard.revision + 1,
          occurredAt: new Date().toISOString(),
          aggregateId: cardId,
          aggregateType: "card",
          payload: {
            cardId,
            boardId: currentCard.boardId, // ✅ FIX: boardId ارسال می‌شود
          },
        },
        optimistic: true,
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

  addList: (list) =>
    set((state) => {
      const envelope: ClientEventEnvelope<ListCreatedEvent> = {
        event: {
          id: crypto.randomUUID(),
          type: "list.created",
          version: list.revision ?? 0,
          occurredAt: new Date().toISOString(),
          aggregateId: list.id ?? "",
          aggregateType: "list",
          payload: {
            listId: list.id ?? "",
            boardId: list.boardId ?? "", // ✅ FIX 5: boardId required در ListCreatedPayload
            title: list.title ?? "",
            position: list.position ?? "",
          },
        },
        optimistic: true,
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

  replaceList: (tempId, serverList) =>
    set((state) => {
      const existing = state.lists[tempId];
      if (!existing) return state;

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
      const { [listId]: _removedList, ...remainingLists } = state.lists;
      const { [listId]: _removedCards, ...remainingCardsByList } =
        state.cardsByList;

      return {
        lists: remainingLists,
        cardsByList: remainingCardsByList,
        listOrder: state.listOrder.filter((id) => id !== listId),
      };
    }),

  moveList: (fromIndex, toIndex) =>
    set((state) => {
      const listId = state.listOrder[fromIndex];
      if (!listId) return state;

      const list = state.lists[listId];

      const envelope: ClientEventEnvelope<ListMovedEvent> = {
        event: {
          id: crypto.randomUUID(),
          type: "list.moved",
          version: list.revision + 1,
          occurredAt: new Date().toISOString(),
          aggregateId: listId,
          aggregateType: "list",
          payload: {
            listId,
            boardId: list.boardId ?? "", // ✅ FIX 6: boardId required در ListMovedPayload
            oldPosition: list.position,  // ✅ FIX 7: oldPosition required در ListMovedPayload
            newPosition: list.position + "V",
          },
        },
        optimistic: true,
      };

      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),
}));
