// apps/web/src/features/board/store/__tests__/integration/optimisticReconciliation.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useBoardStore } from "../../useBoardStore";
import { createSnapshot } from "../../mutations/core/createSnapshot";
import type { WsEvent } from "../../useBoardStore";

// ============================================================================
// 🛠️ Mocks & Setup
// ============================================================================

// Mock کردن crypto برای تولید ID ثابت در تست‌ها
vi.stubGlobal("crypto", {
  randomUUID: () => `test-uuid-${Math.floor(Math.random() * 10000)}`,
});

const MOCK_BOARD_ID = "board-1";
const MOCK_CORRELATION_ID = "tx-123";

// دیتای اولیه برای تزریق به استور (۲ لیست و ۲ کارت)
const initialData = [
  {
    id: "list-1",
    title: "To Do",
    position: "a",
    revision: 1,
    cards: [
      { id: "card-1", boardId: MOCK_BOARD_ID, listId: "list-1", title: "Task A", position: "a", revision: 1 },
      { id: "card-2", boardId: MOCK_BOARD_ID, listId: "list-1", title: "Task B", position: "b", revision: 1 },
    ],
  },
  {
    id: "list-2",
    title: "In Progress",
    position: "b",
    revision: 1,
    cards: [],
  },
];

// ============================================================================
// 🧪 Test Suite
// ============================================================================

describe("Optimistic Reconciliation Engine (Phase 2.5)", () => {
  
  beforeEach(() => {
    // ریست کردن استور و تزریق دیتای اولیه قبل از هر تست
    const store = useBoardStore.getState();
    store.initBoard(initialData, "100"); // Sequence اولیه: 100
  });

  // --------------------------------------------------------------------------
  // سناریو ۱: مسیر موفق (تطبیق تراکنش کاربر با پیام سرور)
  // --------------------------------------------------------------------------
  it("should apply optimistic update and seamlessly reconcile with WebSocket ACK", () => {
    const store = useBoardStore.getState();

    // ۱. شبیه‌سازی اکشن کلاینت (Drag & Drop کارت ۱ به لیست ۲)
    store.applyEvent({
      event: {
        id: "evt-1",
        type: "card.moved",
        aggregateId: "card-1",
        aggregateType: "card",
        version: 2, // ورژن موقت کلاینت
        occurredAt: new Date().toISOString(),
        correlationId: MOCK_CORRELATION_ID,
        payload: {
          cardId: "card-1",
          boardId: MOCK_BOARD_ID,
          fromListId: "list-1",
          toListId: "list-2",
          oldPosition: "a",
          newPosition: "aV", // پوزیشن موقت کلاینت
        },
      } as any,
      optimistic: true,
      acknowledged: false,
    }, { mode: "live" });

    // ثبت در رجیستری تراکنش‌ها
    store.registerPendingMutation({
      correlationId: MOCK_CORRELATION_ID,
      type: "card.moved",
      createdAt: Date.now(),
      aggregateId: "card-1",
      retryCount: 0,
      status: "pending",
    });

    // بررسی UI: آیا کارت در کلاینت جابجا شده؟ (باید بلافاصله جابجا شود)
    let currentState = useBoardStore.getState();
    expect(currentState.cards["card-1"].listId).toBe("list-2");
    expect(currentState.cards["card-1"].position).toBe("aV");
    expect(currentState.pendingMutations[MOCK_CORRELATION_ID]).toBeDefined();

    // ۲. شبیه‌سازی دریافت تاییدیه از وب‌ساکت سرور (LexoRank واقعی)
    const serverWsEvent: WsEvent = {
      sequence: "101",
      type: "card.moved",
      payload: {
        id: "evt-server-1",
        type: "card.moved",
        aggregateId: "card-1",
        aggregateType: "card",
        version: 2,
        occurredAt: new Date().toISOString(),
        correlationId: MOCK_CORRELATION_ID, // 🌟 کلید تطبیق
        payload: {
          cardId: "card-1",
          boardId: MOCK_BOARD_ID,
          fromListId: "list-1",
          toListId: "list-2",
          oldPosition: "a",
          newPosition: "m", // 🌟 پوزیشن واقعی محاسبه شده توسط سرور
        },
      } as any,
    };

    useBoardStore.getState().applyWebsocketEvent(serverWsEvent);

    // ۳. بررسی نهایی (Reconciliation)
    currentState = useBoardStore.getState();
    expect(currentState.boardSequence).toBe("101");
    // کارت باید پوزیشن سرور را گرفته باشد بدون پرش UI
    expect(currentState.cards["card-1"].position).toBe("m"); 
    // تراکنش باید از رجیستری حذف شده باشد چون تایید شد
    expect(currentState.pendingMutations[MOCK_CORRELATION_ID]).toBeUndefined(); 
  });

  // --------------------------------------------------------------------------
  // سناریو ۲: مسیر شکست (رول‌بک اتمیک در صورت ارور سرور)
  // --------------------------------------------------------------------------
  it("should rollback atomic snapshot if server rejects the mutation", () => {
    const store = useBoardStore.getState();

    // ۱. گرفتن اسنپ‌شات قبل از تغییر
    const target = { cards: ["card-2"], lists: ["list-1", "list-2"] };
    const snapshot = createSnapshot(store, target);

    // ۲. جابجایی کارت ۲ در کلاینت
    store.applyEvent({
      event: { id: "evt-2", type: "card.moved", aggregateId: "card-2", payload: { cardId: "card-2", fromListId: "list-1", toListId: "list-2", newPosition: "bV" } } as any,
      optimistic: true,
    }, { mode: "live" });

    // تایید اینکه کارت در UI جابجا شده است
    let currentState = useBoardStore.getState();
    expect(currentState.cards["card-2"].listId).toBe("list-2");

    // ۳. شبیه‌سازی ارور در tRPC و فراخوانی متد restoreSnapshot
    useBoardStore.getState().restoreSnapshot(snapshot);

    // ۴. بررسی رول‌بک
    currentState = useBoardStore.getState();
    // 🌟 جادو اینجاست: کارت ۲ دقیقاً به لیست ۱ برگشت بدون اینکه دیتای بقیه بورد خراب شود!
    expect(currentState.cards["card-2"].listId).toBe("list-1");
    expect(currentState.cards["card-2"].position).toBe("b");
  });

  // --------------------------------------------------------------------------
  // سناریو ۳: سیستم تشخیص شکاف و بافرینگ (Gap Detection)
  // --------------------------------------------------------------------------
  it("should buffer out-of-order messages and apply them sequentially", () => {
    const store = useBoardStore.getState();
    expect(store.boardSequence).toBe("100");

    // ۱. سرور رویداد شماره 102 را می‌فرستد (رویداد 101 در راه گم شده است!)
    store.applyWebsocketEvent({
      sequence: "102",
      type: "card.updated",
      payload: { id: "evt-102", version: 2, payload: { cardId: "card-1", changes: { title: "Title 102" } } } as any
    });

    let currentState = useBoardStore.getState();
    // بورد نباید آپدیت شود، پیام باید برود در بافر
    expect(currentState.boardSequence).toBe("100");
    expect(currentState.syncStatus).toBe("gap_detected");
    expect(currentState.bufferedEvents["102"]).toBeDefined();
    expect(currentState.cards["card-1"].title).toBe("Task A"); // تایتل نباید عوض شده باشد

    // ۲. رویداد گم شده (101) بالاخره می‌رسد
    store.applyWebsocketEvent({
      sequence: "101",
      type: "card.updated",
      payload: { id: "evt-101", version: 2, payload: { cardId: "card-2", changes: { title: "Title 101" } } } as any
    });

    // ۳. بررسی تخلیه بافر (Buffer Draining)
    currentState = useBoardStore.getState();
    // 🌟 جادو: هم رویداد 101 اعمال شد و هم بافر تخلیه شد و 102 اعمال شد!
    expect(currentState.boardSequence).toBe("102");
    expect(currentState.syncStatus).toBe("healthy");
    expect(Object.keys(currentState.bufferedEvents).length).toBe(0);
    expect(currentState.cards["card-2"].title).toBe("Title 101");
    expect(currentState.cards["card-1"].title).toBe("Title 102");
  });

});