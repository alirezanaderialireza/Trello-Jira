// apps/web/src/features/board/store/useBoardStore.ts

import { create } from "zustand";
import { telemetry } from "@/lib/telemetry/logEvent";

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
// 🛡️ Phase 1-2 DTOs (unchanged — backward-compatible)
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
  // ── Phase 4 additions (all optional so existing hydration paths are unbroken)
  labels?: string[];       // labelId[]
  checklists?: string[];   // checklistId[]
  assignees?: string[];    // userId[]
  attachments?: string[];  // attachmentId[]
  /**
   * Phase 1.2 (F1.2.2). Wire format: `YYYY-MM-DD` (DateOnly) or null
   * when unset. Source of truth is the `cards.due_date` DATE column;
   * the v2 `card.due_date_updated` event carries `newDueDate` for
   * realtime updates.
   */
  dueDate?: string | null;
  locked?: boolean;
};

export type ListDto = {
  id: string;
  title: string;
  position: string;
  revision: number;
  updatedAt?: string | number;
  isOptimistic?: boolean;
};

// ============================================================================
// 🆕 Phase 4 DTOs
// ============================================================================

export type LabelDto = {
  id: string;
  boardId: string;
  name: string;
  /**
   * Phase 1.2 (F1.2.1) — replaced the v1 `color` (hex string) with a
   * named token from the canonical 12-token palette
   * (`@repo/domain` → COLOR_TOKENS). UI components map the token to a
   * CSS colour via a centralised lookup so a future palette swap
   * touches one file, not every consumer.
   */
  colorToken: string;
  /**
   * LexoRank ordering token. Used by the manager (drag-and-drop
   * reorder) and the picker (display order). Generated server-side on
   * create, client-side via `@repo/domain/ordering` on reorder.
   */
  position: string;
  revision: number;
  isOptimistic?: boolean;
};

export type ChecklistItemDto = {
  id: string;
  title: string;
  completed: boolean;
};

export type ChecklistDto = {
  id: string;
  cardId: string;
  boardId: string;
  name: string;
  items: ChecklistItemDto[];
  revision: number;
  isOptimistic?: boolean;
};

export type CommentDto = {
  id: string;
  cardId: string;
  boardId: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt?: string;
  revision: number;
  isOptimistic?: boolean;
};

export type AttachmentDto = {
  id: string;
  cardId: string;
  boardId: string;
  url: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  isOptimistic?: boolean;
};

export type TemplateDto = {
  id: string;
  boardId: string;
  name: string;
  description?: string;
  structure: {
    lists: Array<{ id: string; title: string; position: string }>;
    cards: Array<{
      id: string;
      title: string;
      position: string;
      listId: string;
      description?: string;
    }>;
  };
  createdAt: string;
  updatedAt: string;
  revision: number;
  isOptimistic?: boolean;
};

/** A single entry in the windowed activity feed. */
export type ActivityEntry = {
  /** Unique activity event ID. */
  id: string;
  boardId: string;
  actorId: string;
  tenantId: string;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
  correlationId?: string;
  /** Dot-notation event type, e.g. "card.created". */
  eventType: string;
  /** Shallow copy of the relevant event payload for display / audit. */
  payload: Record<string, unknown>;
};

// ============================================================================
// 🛡️ Snapshots — extended with Phase 4 slices
// ============================================================================

export interface BoardSnapshot {
  // ── Phase 1-2 (unchanged keys) ──────────────────────────────────────────
  cards?: Record<string, CardDto>;
  cardsByList?: Record<string, string[]>;
  lists?: Record<string, ListDto>;
  listOrder?: string[];
  // ── Phase 4 ─────────────────────────────────────────────────────────────
  labels?: Record<string, LabelDto>;
  checklists?: Record<string, ChecklistDto>;
  /** commentsByCard[cardId] = commentId[] */
  commentsByCard?: Record<string, string[]>;
  comments?: Record<string, CommentDto>;
  /** attachmentsByCard[cardId] = attachmentId[] */
  attachmentsByCard?: Record<string, string[]>;
  attachments?: Record<string, AttachmentDto>;
  templates?: Record<string, TemplateDto>;
}

// ============================================================================
// 🌐 WS Contracts & Transaction Types (unchanged)
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

/**
 * SyncStatus — extended union that covers both the legacy 4-value enum that
 * boardRealtimeClient / useSyncStatus depend on AND the FSM-derived values
 * that reconcileIncomingEvent / useSyncOrchestrator write.
 *
 * Legacy values (written by boardRealtimeClient + read by useSyncStatus):
 *   "healthy"     — connected, no gap
 *   "gap_detected"— sequence gap detected, buffering
 *   "reconnecting"— WS dropped, retrying
 *   "desynced"    — unrecoverable, full resync required
 *
 * FSM-derived values (written by reconcileIncomingEvent + useSyncOrchestrator):
 *   "synced"      — equivalent to "healthy"
 *   "catching_up" — equivalent to "gap_detected"
 *   "offline"     — equivalent to "desynced" (transport terminal)
 *   "IDLE" | "CONNECTING" | "HEALTHY" | "GAP" | "REPLAYING" | "DESYNCED"
 *                 — raw FSM SyncState values mirrored by useSyncOrchestrator
 *
 * UI consumers should use useSyncStatus() which normalises all values into
 * UISyncStatus — never switch on this type directly.
 */
export type SyncStatus =
  // ── Legacy values (boardRealtimeClient path) ─────────────────────────────
  | "healthy"
  | "gap_detected"
  | "reconnecting"
  | "desynced"
  // ── FSM-derived values (reconcileIncomingEvent + useSyncOrchestrator) ────
  | "synced"
  | "catching_up"
  | "offline"
  // ── Raw FSM SyncState values (useSyncOrchestrator mirror path) ───────────
  | "IDLE"
  | "CONNECTING"
  | "HEALTHY"
  | "GAP"
  | "REPLAYING"
  | "DESYNCED"
  | "RECONNECTING";

// ============================================================================
// 🌟 PURE STORE STATE — Phase 4 additions
// ============================================================================

export interface BoardStoreState {
  // ── Phase 1-2 projections ────────────────────────────────────────────────
  lists: Record<string, ListDto>;
  cards: Record<string, CardDto>;
  cardsByList: Record<string, string[]>;
  listOrder: string[];

  // ── Phase 4 projections ──────────────────────────────────────────────────
  labels: Record<string, LabelDto>;
  /** labelsByBoard[boardId] = labelId[] — ordered for display */
  labelsByBoard: Record<string, string[]>;

  checklists: Record<string, ChecklistDto>;
  /** checklistsByCard[cardId] = checklistId[] */
  checklistsByCard: Record<string, string[]>;

  comments: Record<string, CommentDto>;
  /** commentsByCard[cardId] = commentId[] — insertion order (append-only) */
  commentsByCard: Record<string, string[]>;

  attachments: Record<string, AttachmentDto>;
  /** attachmentsByCard[cardId] = attachmentId[] */
  attachmentsByCard: Record<string, string[]>;

  templates: Record<string, TemplateDto>;
  /** templatesByBoard[boardId] = templateId[] */
  templatesByBoard: Record<string, string[]>;

  /**
   * Windowed activity feed — last ACTIVITY_WINDOW_SIZE entries for the board.
   * Append-only, FIFO eviction once the window is full.
   * IDs are activity event IDs (not domain event IDs).
   */
  activityFeed: ActivityEntry[];

  // ── Sync meta ────────────────────────────────────────────────────────────
  boardSequence: string;
  bufferedEvents: Record<string, WsEvent>;
  syncStatus: SyncStatus;
  pendingMutations: Record<string, PendingMutation>;
}

/** Maximum number of activity entries kept in the client-side window. */
export const ACTIVITY_WINDOW_SIZE = 500;

// ============================================================================
// ⚙️ ACTIONS
// ============================================================================

export interface BoardStoreActions {
  // ── Core Event Machine ───────────────────────────────────────────────────
  initBoard: (
    listsData: (ListDto & { cards: CardDto[] })[],
    sequence: string
  ) => void;

  applyEvent: (
    envelope: ClientEventEnvelope,
    context: ReducerContext
  ) => void;

  applyWebsocketEvent: (event: WsEvent) => void;

  // ── Transaction Management ───────────────────────────────────────────────
  registerPendingMutation: (mutation: PendingMutation) => void;
  resolvePendingMutation: (correlationId: string) => void;
  updatePendingMutationStatus: (
    correlationId: string,
    status: PendingMutation["status"]
  ) => void;
  restoreSnapshot: (snapshot: BoardSnapshot) => void;
  gcPendingMutations: () => void;

  // ── Activity Feed ────────────────────────────────────────────────────────
  /** Append an activity entry; evicts oldest when window is full. */
  appendActivity: (entry: ActivityEntry) => void;

  // ── Legacy Bridge Actions (Phase 1-2, unchanged) ─────────────────────────
  addCard: (card: Partial<CardDto>) => void;
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
// 🆕 Phase 4 initial-state helpers (pure functions — not Zustand-bound)
// ============================================================================

function emptyPhase4State(): Pick<
  BoardStoreState,
  | "labels"
  | "labelsByBoard"
  | "checklists"
  | "checklistsByCard"
  | "comments"
  | "commentsByCard"
  | "attachments"
  | "attachmentsByCard"
  | "templates"
  | "templatesByBoard"
  | "activityFeed"
> {
  return {
    labels: {},
    labelsByBoard: {},
    checklists: {},
    checklistsByCard: {},
    comments: {},
    commentsByCard: {},
    attachments: {},
    attachmentsByCard: {},
    templates: {},
    templatesByBoard: {},
    activityFeed: [],
  };
}

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
  ...emptyPhase4State(),

  // ==========================================================================
  // 📥 Hydration
  // ==========================================================================

  initBoard: (listsData, sequence) =>
    set(() => {
      const newLists: Record<string, ListDto> = {};
      const newCards: Record<string, CardDto> = {};
      const newCardsByList: Record<string, string[]> = {};
      const newListOrder: string[] = [];

      const sortedLists = [...(listsData || [])].sort(
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
        // Reset Phase 4 slices on board init so stale cross-board data is cleared
        ...emptyPhase4State(),
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

  restoreSnapshot: (snapshot) =>
    set((state) => {
      const nextCards        = { ...state.cards };
      const nextLists        = { ...state.lists };
      const nextCardsByList  = { ...state.cardsByList };
      const nextLabels       = { ...state.labels };
      const nextChecklists   = { ...state.checklists };
      const nextComments     = { ...state.comments };
      const nextCommentsByCard  = { ...state.commentsByCard };
      const nextAttachments  = { ...state.attachments };
      const nextAttachmentsByCard = { ...state.attachmentsByCard };
      const nextTemplates    = { ...state.templates };

      // ── cards (stale-protected) ──────────────────────────────────────────
      if (snapshot.cards) {
        Object.entries(snapshot.cards).forEach(([id, snapCard]) => {
          const current = state.cards[id];
          if (current && current.revision > snapCard.revision) {
            telemetry.log("SNAPSHOT_MANAGER", "ROLLBACK_SKIPPED", {
              entityId: id,
              currentRevision: current.revision,
              snapshotRevision: snapCard.revision,
              reason: "stale_protection",
            });
            return;
          }
          nextCards[id] = snapCard;
        });
      }

      // ── lists ────────────────────────────────────────────────────────────
      if (snapshot.lists) {
        Object.entries(snapshot.lists).forEach(([id, snapList]) => {
          if (!state.lists[id] || state.lists[id].revision <= snapList.revision) {
            nextLists[id] = snapList;
          }
        });
      }

      // ── cardsByList ──────────────────────────────────────────────────────
      if (snapshot.cardsByList) {
        Object.entries(snapshot.cardsByList).forEach(([id, snapArr]) => {
          const currentList = state.lists[id];
          const snapList    = snapshot.lists?.[id];
          if (!currentList || (snapList && currentList.revision <= snapList.revision)) {
            nextCardsByList[id] = [...snapArr];
          }
        });
      }

      // ── labels ───────────────────────────────────────────────────────────
      if (snapshot.labels) {
        Object.entries(snapshot.labels).forEach(([id, snapLabel]) => {
          const current = state.labels[id];
          if (!current || current.revision <= snapLabel.revision) {
            nextLabels[id] = snapLabel;
          }
        });
      }

      // ── checklists ───────────────────────────────────────────────────────
      if (snapshot.checklists) {
        Object.entries(snapshot.checklists).forEach(([id, snapCl]) => {
          const current = state.checklists[id];
          if (!current || current.revision <= snapCl.revision) {
            nextChecklists[id] = snapCl;
          }
        });
      }

      // ── comments ─────────────────────────────────────────────────────────
      if (snapshot.comments) {
        Object.entries(snapshot.comments).forEach(([id, snapComment]) => {
          const current = state.comments[id];
          if (!current || current.revision <= snapComment.revision) {
            nextComments[id] = snapComment;
          }
        });
      }
      if (snapshot.commentsByCard) {
        Object.entries(snapshot.commentsByCard).forEach(([cardId, arr]) => {
          nextCommentsByCard[cardId] = [...arr];
        });
      }

      // ── attachments ──────────────────────────────────────────────────────
      if (snapshot.attachments) {
        Object.entries(snapshot.attachments).forEach(([id, snapAtch]) => {
          nextAttachments[id] = snapAtch;
        });
      }
      if (snapshot.attachmentsByCard) {
        Object.entries(snapshot.attachmentsByCard).forEach(([cardId, arr]) => {
          nextAttachmentsByCard[cardId] = [...arr];
        });
      }

      // ── templates ────────────────────────────────────────────────────────
      if (snapshot.templates) {
        Object.entries(snapshot.templates).forEach(([id, snapTpl]) => {
          nextTemplates[id] = snapTpl;
        });
      }

      return {
        cards:              nextCards,
        lists:              nextLists,
        cardsByList:        nextCardsByList,
        listOrder:          snapshot.listOrder ? [...snapshot.listOrder] : state.listOrder,
        labels:             nextLabels,
        checklists:         nextChecklists,
        comments:           nextComments,
        commentsByCard:     nextCommentsByCard,
        attachments:        nextAttachments,
        attachmentsByCard:  nextAttachmentsByCard,
        templates:          nextTemplates,
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
  // 📊 Activity Feed
  // ==========================================================================

  appendActivity: (entry) =>
    set((state) => {
      // Idempotent: never append a duplicate id
      if (state.activityFeed.some((e) => e.id === entry.id)) return state;

      const next = [...state.activityFeed, entry];
      // FIFO eviction — keep only the newest ACTIVITY_WINDOW_SIZE entries
      const windowed =
        next.length > ACTIVITY_WINDOW_SIZE
          ? next.slice(next.length - ACTIVITY_WINDOW_SIZE)
          : next;

      return { activityFeed: windowed };
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
  // 🌉 LEGACY BRIDGE ACTIONS (Phase 1-2, fully preserved)
  // ==========================================================================

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
            cardId:   card.id ?? "",
            listId:   card.listId ?? "",
            boardId:  card.boardId ?? "",
            title:    card.title ?? "",
            position: card.position ?? "",
          },
        },
        optimistic: card.isOptimistic,
      };
      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

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
            oldPosition: currentCard.position,
            newPosition: currentCard.position + "V",
            boardId:     currentCard.boardId,
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
            changes,
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
            cardId:  tempId,
            boardId: serverCard.boardId ?? "",
            changes: { ...serverCard, isOptimistic: false } as { title?: string; description?: string },
          },
        },
        optimistic: false,
      };
      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

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
          payload: { cardId, boardId: currentCard.boardId },
        },
        optimistic: true,
      };
      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),

  addList: (list) =>
    set((state) => {
      const boardId = (list as any).boardId ?? "";

      const envelope: ClientEventEnvelope<ListCreatedEvent> = {
        event: {
          id: crypto.randomUUID(),
          type: "list.created",
          version: list.revision ?? 0,
          occurredAt: new Date().toISOString(),
          aggregateId: list.id ?? "",
          aggregateType: "list",
          payload: {
            listId:   list.id ?? "",
            title:    list.title ?? "",
            position: list.position ?? "",
            boardId,
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
      const { [listId]: _rl, ...remainingLists }     = state.lists;
      const { [listId]: _rc, ...remainingCardsByList } = state.cardsByList;
      return {
        lists:       remainingLists,
        cardsByList: remainingCardsByList,
        listOrder:   state.listOrder.filter((id) => id !== listId),
      };
    }),

  moveList: (fromIndex, toIndex) =>
    set((state) => {
      const listId = state.listOrder[fromIndex];
      if (!listId) return state;

      const list    = state.lists[listId];
      const boardId = (list as any).boardId ?? "";

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
            boardId,
            oldPosition: list.position,
            newPosition: list.position + "V",
          },
        },
        optimistic: true,
      };
      return dispatcherApplyEvent(state, envelope, { mode: "live" });
    }),
}));
