// packages/domain/src/card/types.ts

import type { DateOnly } from "../shared/date-types";

export interface Card {
  id: string;
  tenantId: string;
  boardId: string;    // 🌟 اضافه شد
  listId: string;
  title: string;
  description: string | null;
  position: string;
  revision: number;   // 🌟 اضافه شد (برای OCC Lock)
  /**
   * Wall-clock due date — `YYYY-MM-DD`, no timezone shift, or null if
   * unset. Phase 1.2 (F1.2.2). The DB column is `cards.due_date DATE`;
   * `DateOnly` mirrors the on-the-wire shape used by the time engine
   * in `apps/web/src/lib/date.ts`. Server-side overdue / today
   * comparisons must go through `isOverdue` (lib/date.ts) — never
   * `new Date()` against a `DateOnly`.
   */
  dueDate: DateOnly | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null; // 🌟 اضافه شد (برای Soft Delete)
}