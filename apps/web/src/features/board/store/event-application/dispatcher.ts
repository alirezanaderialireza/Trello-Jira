// apps/web/src/features/board/store/event-application/dispatcher.ts

import type {
  AppDomainEvent,
  CardCreatedEvent,
  CardUpdatedEvent,
  CardDeletedEvent,
  CardMovedEvent,
  ListCreatedEvent,
  ListUpdatedEvent,
  ListMovedEvent,
  ListDeletedEvent,
} from "@repo/domain";

import type { BoardStoreState } from "../useBoardStore";
import { telemetry } from "../../devtools/logEvent";

import type { ClientEventEnvelope } from "./types";
import type { ReducerContext } from "./context";

// ============================================================================
// 🛡️ Pure Reducers
// ============================================================================

import { applyCardMoved } from "./applyCardMoved";
import { applyCardCreated } from "./applyCardCreated";
import { applyCardUpdated } from "./applyCardUpdated";
import { applyCardDeleted } from "./applyCardDeleted";

import { applyListMoved } from "./applyListMoved";
import { applyListCreated } from "./applyListCreated";
import { applyListUpdated } from "./applyListUpdated";
import { applyListDeleted } from "./applyListDeleted";

// ============================================================================
// 🌟 Event Handler Contract
// ============================================================================

/**
 * تمام Reducerها:
 * - Pure هستند
 * - فقط State خام می‌گیرند
 * - فقط Partial State برمی‌گردانند
 * - به Zustand وابسته نیستند
 */
export type EventHandler<TEvent extends AppDomainEvent = AppDomainEvent> = (
  state: BoardStoreState,
  envelope: ClientEventEnvelope<TEvent>,
  context: ReducerContext,
) => Partial<BoardStoreState>;

// ============================================================================
// 📚 Canonical Event Map
// ============================================================================

/**
 * این مپ:
 * - ارتباط بین event.type و payload type را تضمین می‌کند
 * - از typo جلوگیری می‌کند
 * - باعث autocomplete کامل می‌شود
 */
type EventMap = {
  // ==========================================================================
  // Card Events
  // ==========================================================================

  "card.created": CardCreatedEvent;

  "card.updated": CardUpdatedEvent;

  "card.deleted": CardDeletedEvent;

  "card.moved": CardMovedEvent;

  // ==========================================================================
  // List Events
  // ==========================================================================

  "list.created": ListCreatedEvent;

  "list.updated": ListUpdatedEvent;

  "list.moved": ListMovedEvent;

  "list.deleted": ListDeletedEvent;
};

// ============================================================================
// 🧠 Strict Registry Type
// ============================================================================

type HandlerRegistry = {
  [K in keyof EventMap]: EventHandler<EventMap[K]>;
};

// ============================================================================
// 🚀 Reducer Registry
// ============================================================================

/**
 * O(1) Lookup
 *
 * سریع‌تر و maintainable تر از switch-case
 */
const HANDLERS: HandlerRegistry = {
  // ==========================================================================
  // Card Reducers
  // ==========================================================================

  "card.moved": applyCardMoved,

  "card.created": applyCardCreated,

  "card.updated": applyCardUpdated,

  "card.deleted": applyCardDeleted,

  // ==========================================================================
  // List Reducers
  // ==========================================================================

  "list.moved": applyListMoved,

  "list.created": applyListCreated,

  "list.updated": applyListUpdated,

  "list.deleted": applyListDeleted,
};

// ============================================================================
// 👑 Main Dispatcher
// ============================================================================

/**
 * تنها entry point مجاز برای mutation state
 */
export function applyEvent(
  state: BoardStoreState,
  envelope: ClientEventEnvelope,
  context: ReducerContext,
): Partial<BoardStoreState> {
  
  // ==========================================================================
  // Resolve Event Type & Correlation
  // ==========================================================================
  const eventType = envelope.event.type as keyof EventMap;
  const correlationId = envelope.event.correlationId; // استخراج کلید ردیابی

  // 🌟 TELEMETRY: ثبت ورود ایونت به موتور پردازش
  telemetry.log(
    "MUTATION_ENGINE",
    context.mode === "live" ? "APPLY_LIVE" : "APPLY_OPTIMISTIC",
    { eventType, mode: context.mode },
    { correlationId }
  );

  // ==========================================================================
  // Resolve Handler
  // ==========================================================================
  const handler = HANDLERS[eventType];

  // ==========================================================================
  // Unknown Event Protection
  // ==========================================================================
  /**
   * ممکن است کلاینت قدیمی‌تر از سرور باشد
   * بنابراین نباید crash کنیم
   */
  if (!handler) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[Dispatcher] Unknown event type: "${eventType}"`);
    }

    // 🌟 TELEMETRY: شکار ایونت‌هایی که کلاینت هنوز آپدیتش رو نگرفته
    telemetry.log(
      "MUTATION_ENGINE", 
      "UNKNOWN_EVENT_DROPPED", 
      { eventType }, 
      { correlationId }
    );

    return {};
  }

  // ==========================================================================
  // Atomic Reducer Execution
  // ==========================================================================
  try {
    const nextState = (handler as EventHandler)(
      state,
      envelope,
      context,
    );

    // 🌟 TELEMETRY: ثبتِ موفقیت‌آمیز بودنِ تغییرِ خوش‌بینانه
    if (context.mode !== "live" && correlationId) {
      telemetry.mutation(correlationId, eventType, "OPTIMISTIC_APPLIED");
    }

    return nextState;

  } catch (error: any) {
    // ==========================================================================
    // Reducer Isolation Boundary
    // ==========================================================================
    /**
     * اگر یک reducer crash کند:
     * - کل store corrupt نمی‌شود
     * - state قبلی حفظ می‌شود
     * - فقط همان event drop می‌شود
     */
    console.error(
      `[Dispatcher] Failed applying "${eventType}" event.`,
      {
        error,
        event: envelope.event,
        context,
      },
    );

    // 🌟 TELEMETRY: ثبت حیاتی‌ترین خطای سیستم! (باگ در منطقِ Reducer)
    telemetry.log(
      "MUTATION_ENGINE",
      "REDUCER_CRASH",
      { eventType, error: error.message },
      { correlationId }
    );

    return {};
  }
}