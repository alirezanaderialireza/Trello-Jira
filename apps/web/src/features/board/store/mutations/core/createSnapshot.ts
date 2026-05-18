// apps/web/src/features/board/store/mutations/core/createSnapshot.ts

import type { BoardStoreState, BoardSnapshot } from "../../useBoardStore";

export interface SnapshotTarget {
  cards?: string[];
  lists?: string[];
  includeListOrder?: boolean;
}

/**
 * 🌟 The O(1) Deep Snapshot Engine
 * وظیفه: یک کپی عمیق (Deep Clone) و ایزوله فقط از موجودیت‌هایی که 
 * تحت تاثیر Mutation قرار می‌گیرند، تهیه می‌کند.
 */
export function createSnapshot(
  state: BoardStoreState,
  target: SnapshotTarget
): BoardSnapshot {
  const snapshot: BoardSnapshot = {};

  // ==========================================================================
  // ۱. کپی عمیق از کارت‌های هدف (Targeted Cards)
  // ==========================================================================
  if (target.cards && target.cards.length > 0) {
    snapshot.cards = {};
    for (const id of target.cards) {
      if (state.cards[id]) {
        snapshot.cards[id] = structuredClone(state.cards[id]);
      }
    }
  }

  // ==========================================================================
  // ۲. کپی عمیق از لیست‌های هدف و آرایه‌ی کارت‌های داخل آن‌ها
  // ==========================================================================
  if (target.lists && target.lists.length > 0) {
    snapshot.lists = {};
    snapshot.cardsByList = {};
    for (const id of target.lists) {
      // ذخیره وضعیت خود لیست
      if (state.lists[id]) {
        snapshot.lists[id] = structuredClone(state.lists[id]);
      }
      // ذخیره ترتیب کارت‌های داخل این لیست
      if (state.cardsByList[id]) {
        snapshot.cardsByList[id] = structuredClone(state.cardsByList[id]);
      }
    }
  }

  // ==========================================================================
  // ۳. کپی از ترتیب کل لیست‌ها در بورد
  // ==========================================================================
  // این مورد برای زمان‌هایی که یک لیست جدید ساخته می‌شود، لیست حذف می‌شود 
  // یا جای دو لیست عوض می‌شود کاربرد دارد.
  if (target.includeListOrder) {
    snapshot.listOrder = structuredClone(state.listOrder);
  }

  return snapshot;
}