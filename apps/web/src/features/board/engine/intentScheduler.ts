// apps/web/src/features/board/engine/intentScheduler.ts
//
// Phase 1.3 (F1.3.2) — "drag intent" debounce primitive.
//
// During a card drag, dnd-kit fires onDragOver continuously. Opening a gap on
// every event makes lists "flicker" as the pointer sweeps across them. The
// intent scheduler debounces: a visual move only fires after the pointer has
// dwelled over a target for `delayMs` (D4 = 120ms). A fast sweep keeps
// rescheduling and therefore never opens a gap.
//
// Kept as a tiny pure factory with injectable timers so it can be unit-tested
// deterministically with fake timers — no React, no DOM.

export interface IntentScheduler {
  /** (Re)arm the timer. Any previously-scheduled callback is cancelled. */
  schedule(fn: () => void): void;
  /** Cancel a pending callback, if any. */
  cancel(): void;
  /** True while a callback is armed but not yet fired. */
  readonly pending: boolean;
}

export interface SchedulerTimers {
  set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (handle: ReturnType<typeof setTimeout>) => void;
}

const defaultTimers: SchedulerTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle),
};

export function createIntentScheduler(
  delayMs: number,
  timers: SchedulerTimers = defaultTimers,
): IntentScheduler {
  let handle: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(fn: () => void) {
      if (handle !== null) timers.clear(handle);
      handle = timers.set(() => {
        handle = null;
        fn();
      }, delayMs);
    },
    cancel() {
      if (handle !== null) {
        timers.clear(handle);
        handle = null;
      }
    },
    get pending() {
      return handle !== null;
    },
  };
}
