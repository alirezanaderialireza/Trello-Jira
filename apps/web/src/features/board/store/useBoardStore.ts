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
  /**
   * 🌟 Optimistic version (local source of truth for ordering inserts).
   * Bumped by every optimistic mutation, then re-aligned to the server
   * version on ACK. Used by reducers to drop stale optimistic events.
   */
  revision: number;
  /**
   * 🌟 Confirmed (server-canonical) version.
   * Updated only when an event with envelope.acknowledged === true is
   * applied. Used by reducers to drop stale SERVER events:
   *   if (existing.confirmedRevision >= event.version) → drop
   * This is the only safe way to differentiate:
   *   - "I already applied this server event" (drop)
   *   - "I have an optimistic bump but the server's canonical state
   *      should still override my optimistic position" (apply)
   */
  confirmedRevision: number;
  updatedAt?: string | number;
  isOptimistic?: boolean;
};

export type ListDto = {
  id: string;
  boardId: string;
  title: string;
  position: string;
  revision: number;
  /** 🌟 See CardDto.confirmedRevision. */
  confirmedRevision: number;
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
  /**
   * 🌟 restoreSnapshot — atomic rollback of a previously taken snapshot.
   *
   * @param snapshot   targeted slices to restore (cards, lists, cardsByList, listOrder)
   * @param aggregateId  OPTIONAL. When provided, optimistic-card cleanup is
   *                     bound to ONLY this aggregate (the failed mutation's
   *                     aggregate). Without this, parallel optimistic
   *                     mutations in the same list would be wrongfully wiped.
   *                     Tests/integration-paths without a known aggregate
   *                     fall back to the legacy scope-based cleanup.
   */
  restoreSnapshot: (snapshot: BoardSnapshot, aggregateId?: string) => void;
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
          boardId: list.boardId ?? "",
          title: list.title,
          position: list.position,
          revision: list.revision,
          // 🌟 Hydration: server-supplied data is fully confirmed by definition.
          confirmedRevision: list.revision,
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
          // 🌟 Hydration: confirmedRevision = revision (server is the source).
          newCards[card.id] = {
            ...card,
            confirmedRevision: card.confirmedRevision ?? card.revision,
          };

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

  restoreSnapshot: (snapshot, aggregateId) => set((state) => {
    const nextCards = { ...state.cards };
    const nextLists = { ...state.lists };
    const nextCardsByList = { ...state.cardsByList };

    if (snapshot.cards) {
      Object.entries(snapshot.cards).forEach(([id, snapCard]) => {
        const currentCard = state.cards[id];

        // 🌟 Stale Protection علیه server events:
        // اگر کارت در حال حاضر isOptimistic نیست و revision آن جلوتر از snapshot است،
        // یعنی یک رویداد سرور (یا کاربر دیگر) داده‌ی جدیدتری برای ما فرستاده.
        // در این حالت rollback نمی‌کنیم تا کار درست شده‌ی دیگران را نشکنیم.
        // اما اگر کارت هنوز isOptimistic باشد (یعنی revision آن ساختگی است)،
        // rollback را اجرا می‌کنیم چون هنوز توسط سرور تایید نشده.
        if (
          currentCard &&
          !currentCard.isOptimistic &&
          currentCard.revision > snapCard.revision
        ) {
          telemetry.log(
            "SNAPSHOT_MANAGER",
            "ROLLBACK_SKIPPED",
            { entityId: id, currentRevision: currentCard.revision, snapshotRevision: snapCard.revision, reason: "stale_protection" }
          );
          return;
        }

        // 🌟 Rollback واقعی: مقدار snapshot را برمی‌گردانیم
        nextCards[id] = snapCard;
      });

      // 🌟 پاکسازی کارت‌های optimistic که مربوط به همین mutation بوده‌اند ولی در snapshot نبودند.
      //
      // دو حالت:
      // 1) aggregateId داده شده (production path از useOptimisticMutation):
      //    فقط کارتی که id == aggregateId بود را پاک می‌کنیم. این یعنی
      //    optimistic create که aggregateId همان tempId است → پاک می‌شود،
      //    در حالی که سایر کارت‌های optimistic (mutationهای موازی) دست‌نخورده باقی می‌مانند.
      //
      // 2) aggregateId داده نشده (legacy / test path):
      //    fall back به منطق قبلی scope-based: همه‌ی کارت‌های optimistic در
      //    listهای داخل snapshot.cardsByList که در snapshot.cards نبودند پاک می‌شوند.
      if (aggregateId) {
        const target = state.cards[aggregateId];
        if (
          target?.isOptimistic &&
          !snapshot.cards[aggregateId]
        ) {
          delete nextCards[aggregateId];
          telemetry.log(
            "SNAPSHOT_MANAGER",
            "OPTIMISTIC_CARD_PURGED",
            { aggregateId, reason: "aggregate_bound_cleanup" }
          );
        }
      } else if (snapshot.cardsByList) {
        const targetListIds = new Set(Object.keys(snapshot.cardsByList));
        Object.keys(state.cards).forEach((id) => {
          const card = state.cards[id];
          if (
            card?.isOptimistic &&
            !snapshot.cards![id] &&
            targetListIds.has(card.listId)
          ) {
            delete nextCards[id];
          }
        });
      }
    }

    if (snapshot.lists) {
      Object.entries(snapshot.lists).forEach(([id, snapList]) => {
        const currentList = state.lists[id];
        // همان منطق Stale Protection برای لیست‌ها
        if (
          currentList &&
          !currentList.isOptimistic &&
          currentList.revision > snapList.revision
        ) {
          return;
        }
        nextLists[id] = snapList;
      });

      // پاکسازی aggregate-bound برای لیست‌ها (مشابه کارت‌ها)
      if (aggregateId) {
        const targetList = state.lists[aggregateId];
        if (
          targetList?.isOptimistic &&
          !snapshot.lists[aggregateId]
        ) {
          delete nextLists[aggregateId];
          telemetry.log(
            "SNAPSHOT_MANAGER",
            "OPTIMISTIC_LIST_PURGED",
            { aggregateId, reason: "aggregate_bound_cleanup" }
          );
        }
      }
    }

    if (snapshot.cardsByList) {
      Object.entries(snapshot.cardsByList).forEach(([id, snapArr]) => {
        const currentList = state.lists[id];
        const snapList = snapshot.lists?.[id];
        // اگر لیست از سرور به‌روز شده، آرایه ترتیب کارت‌ها را override نمی‌کنیم
        if (
          currentList &&
          !currentList.isOptimistic &&
          snapList &&
          currentList.revision > snapList.revision
        ) {
          return;
        }
        nextCardsByList[id] = [...snapArr];
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
            boardId: card.boardId,
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
            boardId: currentCard.boardId,
            fromListId,
            toListId,
            oldPosition: currentCard.position,
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
            boardId: currentCard.boardId,
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

  /**
   * 🌟 replaceCard — Identity Migration (tempId → serverId)
   * 
   * این یک "update" نیست! سرور پاسخ مرورگر مدت optimistic رو تأیید کرده
   * و یک serverId واقعی برگردونده. باید:
   *  1. tempId رو از همه‌ی indexها (cards, cardsByList) پاک کنیم
   *  2. یک entity جدید با serverId و دیتای کامل بسازیم
   *  3. در همان موقعیت آرایه (همان ترتیب) قرار بدیم
   *
   * این یک atomic state transition است، نه domain event.
   * dispatcher pipeline برای این کار مناسب نیست چون هیچ `card.id_changed` event وجود ندارد.
   */
  replaceCard: (tempId, serverCard) =>
    set((state) => {
      const optimisticCard = state.cards[tempId];

      // اگر tempId وجود ندارد (مثلاً rollback قبلاً اتفاق افتاده)، no-op
      if (!optimisticCard) {
        telemetry.log(
          "REPLACE_CARD",
          "TEMP_NOT_FOUND",
          { tempId, serverId: serverCard.id }
        );
        return state;
      }

      const serverId = serverCard.id;
      if (!serverId) {
        telemetry.log(
          "REPLACE_CARD",
          "INVALID_SERVER_ID",
          { tempId }
        );
        return state;
      }

      // اگر serverId از قبل در state وجود دارد (race condition با websocket event)،
      // فقط tempId رو پاک کنیم و چیز جدیدی نسازیم
      const serverAlreadyExists = !!state.cards[serverId];

      // ساخت entity جدید با merge: optimistic local fields + server authoritative fields
      const finalCard: CardDto = serverAlreadyExists
        ? state.cards[serverId]
        : {
            ...optimisticCard,
            ...serverCard,
            id: serverId,
            boardId: serverCard.boardId ?? optimisticCard.boardId,
            listId: serverCard.listId ?? optimisticCard.listId,
            title: serverCard.title ?? optimisticCard.title,
            position: serverCard.position ?? optimisticCard.position,
            revision: serverCard.revision ?? optimisticCard.revision,
            // 🌟 Server-confirmed identity migration → confirmedRevision aligns with server.
            confirmedRevision:
              serverCard.confirmedRevision ?? serverCard.revision ?? optimisticCard.revision,
            isOptimistic: false,
          };

      // پاکسازی tempId و درج serverId در dictionary
      const { [tempId]: _removed, ...cardsWithoutTemp } = state.cards;
      const nextCards: Record<string, CardDto> = {
        ...cardsWithoutTemp,
        [serverId]: finalCard,
      };

      // در cardsByList، tempId را با serverId جایگزین کنیم (در همان index)
      const targetListId = finalCard.listId;
      const currentListIds = state.cardsByList[targetListId] ?? [];
      const tempIndex = currentListIds.indexOf(tempId);
      const serverIndex = currentListIds.indexOf(serverId);

      let nextListIds: string[];
      if (tempIndex !== -1 && serverIndex !== -1) {
        // race: هر دو وجود دارند → tempId رو حذف کن
        nextListIds = currentListIds.filter((id) => id !== tempId);
      } else if (tempIndex !== -1) {
        // عادی: tempId رو با serverId جایگزین کن
        nextListIds = [
          ...currentListIds.slice(0, tempIndex),
          serverId,
          ...currentListIds.slice(tempIndex + 1),
        ];
      } else if (serverIndex !== -1) {
        // already migrated by websocket
        nextListIds = currentListIds;
      } else {
        // هیچ‌کدام نیست (state inconsistent) → push
        nextListIds = [...currentListIds, serverId];
      }

      return {
        cards: nextCards,
        cardsByList: {
          ...state.cardsByList,
          [targetListId]: nextListIds,
        },
      };
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
            boardId: currentCard.boardId,
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
            boardId: list.boardId,
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

  /**
   * 🌟 replaceList — Identity Migration (tempId → serverId)
   *
   * مشابه replaceCard، اما با scope وسیع‌تر:
   *  1. tempId از state.lists پاک می‌شود
   *  2. cardsByList[tempId] (که شامل کارت‌های child است) به cardsByList[serverId] منتقل می‌شود
   *  3. در listOrder، tempId با serverId جایگزین می‌شود (در همان index)
   *  4. تمام کارت‌هایی که listId آن‌ها tempId است → listId آن‌ها به serverId به‌روز می‌شود
   */
  replaceList: (tempId, serverList) =>
    set((state) => {
      const optimisticList = state.lists[tempId];

      if (!optimisticList) {
        telemetry.log(
          "REPLACE_LIST",
          "TEMP_NOT_FOUND",
          { tempId, serverId: serverList.id }
        );
        return state;
      }

      const serverId = serverList.id;
      if (!serverId) {
        telemetry.log(
          "REPLACE_LIST",
          "INVALID_SERVER_ID",
          { tempId }
        );
        return state;
      }

      const serverAlreadyExists = !!state.lists[serverId];

      const finalList: ListDto = serverAlreadyExists
        ? state.lists[serverId]
        : {
            ...optimisticList,
            ...serverList,
            id: serverId,
            boardId: serverList.boardId ?? optimisticList.boardId,
            title: serverList.title ?? optimisticList.title,
            position: serverList.position ?? optimisticList.position,
            revision: serverList.revision ?? optimisticList.revision,
            // 🌟 Server-confirmed identity migration → confirmedRevision aligns with server.
            confirmedRevision:
              serverList.confirmedRevision ?? serverList.revision ?? optimisticList.revision,
            isOptimistic: false,
          };

      // پاکسازی tempId از lists dictionary
      const { [tempId]: _removedList, ...listsWithoutTemp } = state.lists;
      const nextLists: Record<string, ListDto> = {
        ...listsWithoutTemp,
        [serverId]: finalList,
      };

      // در listOrder، tempId را با serverId جایگزین کنیم (در همان index)
      const tempOrderIndex = state.listOrder.indexOf(tempId);
      const serverOrderIndex = state.listOrder.indexOf(serverId);

      let nextListOrder: string[];
      if (tempOrderIndex !== -1 && serverOrderIndex !== -1) {
        nextListOrder = state.listOrder.filter((id) => id !== tempId);
      } else if (tempOrderIndex !== -1) {
        nextListOrder = [
          ...state.listOrder.slice(0, tempOrderIndex),
          serverId,
          ...state.listOrder.slice(tempOrderIndex + 1),
        ];
      } else if (serverOrderIndex !== -1) {
        nextListOrder = state.listOrder;
      } else {
        nextListOrder = [...state.listOrder, serverId];
      }

      // انتقال cardsByList[tempId] به cardsByList[serverId]
      const { [tempId]: tempCardIds, ...cardsByListWithoutTemp } =
        state.cardsByList;
      const existingServerCardIds = state.cardsByList[serverId] ?? [];
      // merge بدون duplicate
      const mergedCardIds = Array.from(
        new Set([...(tempCardIds ?? []), ...existingServerCardIds])
      );
      const nextCardsByList: Record<string, string[]> = {
        ...cardsByListWithoutTemp,
        [serverId]: mergedCardIds,
      };

      // به‌روزرسانی listId در همه‌ی کارت‌هایی که parent آن‌ها tempId بوده
      const nextCards: Record<string, CardDto> = { ...state.cards };
      let cardsChanged = false;
      Object.entries(state.cards).forEach(([cardId, card]) => {
        if (card.listId === tempId) {
          nextCards[cardId] = { ...card, listId: serverId };
          cardsChanged = true;
        }
      });

      return {
        lists: nextLists,
        listOrder: nextListOrder,
        cardsByList: nextCardsByList,
        ...(cardsChanged ? { cards: nextCards } : {}),
      };
    }),

  deleteList: (listId) =>
    set((state) => {
      const list = state.lists[listId];

      // Idempotency: deleting a missing list is a safe no-op
      if (!list) {
        return state;
      }

      const envelope: ClientEventEnvelope = {
        event: {
          id: crypto.randomUUID(),

          type: "list.deleted",

          version: list.revision + 1,

          occurredAt: new Date().toISOString(),

          aggregateId: listId,

          aggregateType: "list",

          payload: {
            listId,
            boardId: list.boardId,
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
            boardId: list.boardId,
            oldPosition: list.position,
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