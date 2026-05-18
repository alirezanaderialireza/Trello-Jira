import type { BoardStoreState } from "../useBoardStore";

export function createBoardState(
  overrides?: Partial<BoardStoreState>
): BoardStoreState { // 🌟 فقط State خالص را برمی‌گرداند
  return {
    lists: {},
    cards: {},
    cardsByList: {},
    listOrder: [],
    boardSequence: "0",
    bufferedEvents: {},
    syncStatus: "healthy",
    pendingMutations: {}, // 🌟 این خط اضافه شد تا ارور تایپ‌اسکریپت برطرف شود
    ...overrides,
  };
}