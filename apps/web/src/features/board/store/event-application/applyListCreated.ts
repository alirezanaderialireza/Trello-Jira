// apps/web/src/features/board/store/event-application/applyListCreated.ts

import type { ListCreatedEvent } from "@repo/domain";
import type { BoardStoreState } from "../useBoardStore";
import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

/**
 * ------------------------------------------------------------------
 * applyListCreated
 * ------------------------------------------------------------------
 * Responsibilities:
 * - Atomic list creation
 * - Deterministic ordering via LexoRank
 * - Idempotency & Stale Guard (>= version check)
 * - Cards-By-List bucket initialization
 * ------------------------------------------------------------------
 */
export function applyListCreated(
  state: BoardStoreState,
  envelope: ClientEventEnvelope<ListCreatedEvent>,
  _context: ReducerContext,
): Partial<BoardStoreState> {
  const { event } = envelope;
  const { listId, title, position } = event.payload;

  const existingList = state.lists[listId];

  /**
   * 🛡️ 1. Stale & Idempotency Guard
   * اگر لیست از قبل وجود دارد و ورژن آن بزرگتر یا مساوی است،
   * یعنی این رویداد قبلاً اعمال شده یا یک رویداد جدیدتر جای آن را گرفته است.
   */
  if (existingList && existingList.revision >= event.version) {
    return {};
  }

  // ۲. ساخت نهاد (Entity) جدید با حفظ فیلدهای احتمالی محلی
  const newList = {
    ...(existingList ?? {}),
    id: listId,
    title,
    position,
    revision: event.version ?? 0,
    isOptimistic: envelope.optimistic ?? false,
  };

  /**
   * 🛡️ 3. Idempotent Order Update
   * جلوگیری از اضافه شدن چندباره آیدی به listOrder در زمان Replay
   */
  const isAlreadyInOrder = state.listOrder.includes(listId);
  const nextListOrder = isAlreadyInOrder
    ? [...state.listOrder]
    : [...state.listOrder, listId];

  /**
   * 🚀 4. Deterministic Stable Sort
   * تضمین اینکه در تمام کلاینت‌ها ترتیب لیست‌ها دقیقاً یکسان باقی می‌ماند.
   */
  nextListOrder.sort((a, b) => {
    const posA = a === listId ? newList.position : state.lists[a]?.position ?? "";
    const posB = b === listId ? newList.position : state.lists[b]?.position ?? "";
    
    // سورت بر اساس LexoRank و در صورت تساوی، بر اساس ID (Stable Sort)
    return posA.localeCompare(posB) || a.localeCompare(b);
  });

  return {
    lists: {
      ...state.lists,
      [listId]: newList,
    },
    listOrder: nextListOrder,
    /**
     * 📦 5. Bucket Initialization
     * ایجاد فضای خالی برای کارت‌های این لیست اگر از قبل وجود نداشته باشد.
     */
    cardsByList: {
      ...state.cardsByList,
      [listId]: state.cardsByList[listId] ?? [],
    },
  };
}