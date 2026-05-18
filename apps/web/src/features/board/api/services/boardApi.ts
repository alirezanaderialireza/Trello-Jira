// apps/web/src/features/board/api/services/boardApi.ts

/**
 * 🚀 Board API Service (tRPC Bridge)
 * این لایه به عنوان پل ارتباطی بین هوک‌های Mutation و بک‌اند tRPC عمل می‌کند.
 * مزیت: اگر در آینده ساختار tRPC تغییر کند، فقط این فایل آپدیت می‌شود.
 */

import { trpc } from "../../../../utils/trpc"; // 👈 کلاینت tRPC فرانت‌اند خود را اینجا ایمپورت کنید

export const boardApi = {
  // ==========================================
  // 🃏 عملیات مربوط به کارت‌ها (Cards)
  // ==========================================

  /**
   * ایجاد کارت جدید
   * متصل به روت: card.create
   */
  createCard: async (payload: {
    listId: string;
    title: string;
    mutationId: string; // همان correlationId موتور ژنریک ما
  }) => {
    return trpc.card.create.mutateAsync(payload);
  },

  /**
   * جابجایی کارت (Drag & Drop)
   * متصل به روت: board.moveCard
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
    return trpc.board.moveCard.mutateAsync(payload);
  },
  moveList: async (payload: {
    boardId: string;
    listId: string;
    newPosition: string;
    mutationId: string;
  }) => {
    return trpc.board.moveList.mutate(payload);
  },

  /**
   * ویرایش محتوای کارت
   * متصل به روت: card.update
   */
  updateCard: async (payload: {
    id: string;
    title?: string;
    description?: string;
    expectedRevision?: number;
    mutationId: string;
  }) => {
    return trpc.card.update.mutateAsync(payload);
  },

  /**
   * حذف کارت
   * متصل به روت: card.delete
   */
  deleteCard: async (payload: { 
    id: string; 
    mutationId: string; 
  }) => {
    return trpc.card.delete.mutateAsync(payload);
  },

  // ==========================================
  // 📋 عملیات مربوط به لیست‌ها (Lists)
  // ==========================================

  /**
   * ایجاد لیست جدید
   * متصل به روت: list.create
   */
  createList: async (payload: {
    boardId: string;
    title: string;
    mutationId: string;
    expectedBoardRevision?: number;
    expectedAclVersion?: number;
  }) => {
    return trpc.list.create.mutateAsync(payload);
  },

  /**
   * ویرایش عنوان لیست
   * (این روت در بک‌اند شما فعلاً Mock است، اما کلاینت آن آماده است)
   */
  updateList: async (payload: {
    listId: string;
    title: string;
    mutationId: string;
  }) => {
    // @ts-ignore - تا زمانی که روت بک‌اند کاملاً تعریف شود
    return trpc.list.update.mutateAsync(payload);
  },

  /**
   * حذف لیست
   * (این روت در بک‌اند شما فعلاً Mock است)
   */
  deleteList: async (payload: {
    listId: string;
    mutationId: string;
  }) => {
    // @ts-ignore
    return trpc.list.delete.mutateAsync(payload);
  },
};