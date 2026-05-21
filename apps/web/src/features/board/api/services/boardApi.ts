// apps/web/src/features/board/api/services/boardApi.ts

/**
 * 🚀 Board API Service (tRPC Bridge)
 *
 * این لایه به عنوان پل ارتباطی بین هوک‌های Mutation و بک‌اند tRPC عمل می‌کند.
 * مزیت: اگر در آینده ساختار tRPC تغییر کند، فقط این فایل آپدیت می‌شود.
 *
 * 🌟 Routing structure (must match `packages/api/src/index.ts`):
 *   appRouter
 *     └── v1
 *           ├── public
 *           │     ├── board   (board-level mutations: moveCard, moveList, getFullBoard)
 *           │     ├── list    (list CRUD)
 *           │     └── card    (card CRUD)
 *           ├── realtime
 *           ├── internal
 *           └── system
 *
 * Every entry below uses `mutateAsync` (Promise-returning). Mixing `mutate`
 * and `mutateAsync` causes silent fire-and-forget bugs in `await`-based
 * callers (see Phase-1 reviews).
 */

import { trpc } from "../../../../utils/trpc";

export const boardApi = {
  // ==========================================
  // 🃏 عملیات مربوط به کارت‌ها (Cards)
  // ==========================================

  /**
   * ایجاد کارت جدید
   * مسیر: v1.public.card.create
   */
  createCard: async (payload: {
    listId: string;
    title: string;
    mutationId: string; // همان correlationId موتور ژنریک ما
  }) => {
    return trpc.v1.public.card.create.mutateAsync(payload);
  },

  /**
   * جابجایی کارت (Drag & Drop)
   * مسیر: v1.public.board.moveCard
   */
  moveCard: async (payload: {
    cardId: string;
    targetListId: string;
    mode: "APPEND" | "PREPEND" | "INSERT_BETWEEN" | "REORDER_SAME_LIST";
    prevId?: string;
    nextId?: string;
    mutationId: string;
    expectedListRevisions?: Record<string, number>;
  }) => {
    return trpc.v1.public.board.moveCard.mutateAsync(payload);
  },

  /**
   * جابجایی لیست (Reorder lists in a board)
   * مسیر: v1.public.board.moveList
   *
   * 🌟 Note: server endpoint may be a stub at this stage. Use `mutateAsync`
   * (not `mutate`) so that callers using `await` receive a Promise.
   */
  moveList: async (payload: {
    boardId: string;
    listId: string;
    newPosition: string;
    mutationId: string;
  }) => {
    // @ts-ignore - server endpoint may be stubbed during phase 1.x
    return trpc.v1.public.board.moveList.mutateAsync(payload);
  },

  /**
   * ویرایش محتوای کارت
   * مسیر: v1.public.card.update
   */
  updateCard: async (payload: {
    id: string;
    title?: string;
    description?: string;
    expectedRevision?: number;
    mutationId: string;
  }) => {
    return trpc.v1.public.card.update.mutateAsync(payload);
  },

  /**
   * حذف کارت
   * مسیر: v1.public.card.delete
   */
  deleteCard: async (payload: {
    id: string;
    mutationId: string;
  }) => {
    return trpc.v1.public.card.delete.mutateAsync(payload);
  },

  // ==========================================
  // 📋 عملیات مربوط به لیست‌ها (Lists)
  // ==========================================

  /**
   * ایجاد لیست جدید
   * مسیر: v1.public.list.create
   */
  createList: async (payload: {
    boardId: string;
    title: string;
    mutationId: string;
    expectedBoardRevision?: number;
    expectedAclVersion?: number;
  }) => {
    return trpc.v1.public.list.create.mutateAsync(payload);
  },

  /**
   * ویرایش عنوان لیست
   * مسیر: v1.public.list.update
   */
  updateList: async (payload: {
    listId: string;
    title: string;
    mutationId: string;
  }) => {
    // @ts-ignore - تا زمانی که روت بک‌اند کاملاً تعریف شود
    return trpc.v1.public.list.update.mutateAsync(payload);
  },

  /**
   * حذف لیست
   * مسیر: v1.public.list.delete
   */
  deleteList: async (payload: {
    listId: string;
    mutationId: string;
  }) => {
    // @ts-ignore - تا زمانی که روت بک‌اند کاملاً تعریف شود
    return trpc.v1.public.list.delete.mutateAsync(payload);
  },
};
