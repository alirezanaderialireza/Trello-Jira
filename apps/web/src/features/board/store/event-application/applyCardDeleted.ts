// apps/web/src/features/board/store/event-application/applyCardDeleted.ts

import type { CardDeletedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * ------------------------------------------------------------------
 * applyCardDeleted
 * ------------------------------------------------------------------
 * Responsibilities:
 * - Deterministic card removal
 * - O(1) targeted list update
 * - Stale event protection (>= version check)
 * - Idempotency (safe against double deletion)
 * ------------------------------------------------------------------
 */
export function applyCardDeleted(
  state:BoardStoreState,
  envelope: ClientEventEnvelope<CardDeletedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { cardId } = event.payload;

  const existingCard = state.cards[cardId];

  /**
   * 🛡️ 1. Idempotency & Stale Guard
   * اگر کارت وجود ندارد یا قبلاً توسط رویدادی با ورژن بالاتر (مثلاً Recreate) 
   * مدیریت شده، هیچ تغییری اعمال نمی‌کنیم.
   */
  if (!existingCard || existingCard.revision >= event.version) {
    return {};
  }

  // پیدا کردن آیدی لیستی که کارت در آن قرار داشت
  const sourceListId = existingCard.listId;

  /**
   * 🛡️ 2. Referential Integrity Check
   * اگر کارت در لیستِ ادعا شده وجود نداشته باشد، فقط دیکشنری را پاک می‌کنیم.
   * این برای سناریوهای Race Condition بین Move و Delete حیاتی است.
   */
  const currentListIds = state.cardsByList[sourceListId] || [];
  const isCardInList = currentListIds.includes(cardId);

  // حذف کارت از دیکشنری اصلی
  const { [cardId]: _removedCard, ...remainingCards } = state.cards;

  // اگر کارت در لیست نبود، فقط دیکشنری را آپدیت برمی‌گردانیم
  if (!isCardInList) {
    return {
      cards: remainingCards,
    };
  }

  /**
   * 🚀 3. O(1) Targeted Update
   * فقط همان لیستی که تحت تاثیر قرار گرفته را فیلتر می‌کنیم.
   */
  return {
    cards: remainingCards,
    cardsByList: {
      ...state.cardsByList,
      [sourceListId]: currentListIds.filter((id: string) => id !== cardId),
    },
  };
}