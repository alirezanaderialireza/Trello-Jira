// apps/web/src/features/board/engine/__tests__/intentScheduler.test.ts
//
// Phase 1.3 (F1.3.2) — intent-debounce scheduler. Uses a manual fake clock
// (injected timers) so the debounce window is asserted deterministically.

import { describe, it, expect, beforeEach } from "vitest";

import { createIntentScheduler, type SchedulerTimers } from "../intentScheduler";

// A minimal deterministic clock: schedule entries with a due tick, advance
// manually. Mirrors how vitest's fake timers behave but with zero deps.
function makeClock() {
  let now = 0;
  let seq = 0;
  const entries = new Map<number, { due: number; fn: () => void }>();
  const timers: SchedulerTimers = {
    set: (fn, ms) => {
      const id = ++seq;
      entries.set(id, { due: now + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clear: (handle) => {
      entries.delete(handle as unknown as number);
    },
  };
  function advance(ms: number) {
    now += ms;
    for (const [id, e] of [...entries.entries()]) {
      if (e.due <= now) {
        entries.delete(id);
        e.fn();
      }
    }
  }
  return { timers, advance };
}

describe("createIntentScheduler", () => {
  let clock: ReturnType<typeof makeClock>;
  beforeEach(() => {
    clock = makeClock();
  });

  it("fires the callback after the delay", () => {
    const s = createIntentScheduler(120, clock.timers);
    let fired = 0;
    s.schedule(() => fired++);
    expect(s.pending).toBe(true);
    clock.advance(119);
    expect(fired).toBe(0);
    clock.advance(1);
    expect(fired).toBe(1);
    expect(s.pending).toBe(false);
  });

  it("a fast sweep (reschedule before delay) only fires once, with the last fn", () => {
    const s = createIntentScheduler(120, clock.timers);
    const calls: string[] = [];
    s.schedule(() => calls.push("a"));
    clock.advance(50);
    s.schedule(() => calls.push("b"));
    clock.advance(50);
    s.schedule(() => calls.push("c"));
    clock.advance(120);
    expect(calls).toEqual(["c"]);
  });

  it("cancel prevents the callback", () => {
    const s = createIntentScheduler(120, clock.timers);
    let fired = 0;
    s.schedule(() => fired++);
    s.cancel();
    expect(s.pending).toBe(false);
    clock.advance(200);
    expect(fired).toBe(0);
  });
});
