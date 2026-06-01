// apps/web/src/lib/checklists/computeProgress.test.ts

import { describe, it, expect } from "vitest";

import {
  aggregateCardProgress,
  computeProgress,
  type ProgressItem,
} from "./computeProgress";

describe("computeProgress — single checklist", () => {
  it("returns zeros for an empty list (no NaN)", () => {
    expect(computeProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it("returns 100 percent when every item is done", () => {
    const items: ProgressItem[] = [
      { isDone: true },
      { isDone: true },
      { isDone: true },
    ];
    expect(computeProgress(items)).toEqual({ done: 3, total: 3, percent: 100 });
  });

  it("returns 0 percent when nothing is done", () => {
    const items: ProgressItem[] = [
      { isDone: false },
      { isDone: false },
    ];
    expect(computeProgress(items)).toEqual({ done: 0, total: 2, percent: 0 });
  });

  it("rounds to the nearest integer (1/3 → 33)", () => {
    const items: ProgressItem[] = [
      { isDone: true },
      { isDone: false },
      { isDone: false },
    ];
    expect(computeProgress(items).percent).toBe(33);
  });

  it("rounds up at the boundary (2/3 → 67)", () => {
    const items: ProgressItem[] = [
      { isDone: true },
      { isDone: true },
      { isDone: false },
    ];
    expect(computeProgress(items).percent).toBe(67);
  });

  it("counts mixed items correctly", () => {
    const items: ProgressItem[] = [
      { isDone: true },
      { isDone: false },
      { isDone: true },
      { isDone: false },
      { isDone: true },
    ];
    expect(computeProgress(items)).toEqual({ done: 3, total: 5, percent: 60 });
  });

  it("does not mutate its input", () => {
    const items = Object.freeze<ProgressItem[]>([
      { isDone: true },
      { isDone: false },
    ]);
    const before = JSON.stringify(items);
    computeProgress(items);
    expect(JSON.stringify(items)).toBe(before);
  });
});

describe("aggregateCardProgress — many checklists per card", () => {
  it("returns zeros for a card with no checklists", () => {
    expect(aggregateCardProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it("returns zeros for a card whose checklists all have no items", () => {
    expect(
      aggregateCardProgress([{ items: [] }, { items: [] }]),
    ).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it("sums done and total across every checklist", () => {
    const result = aggregateCardProgress([
      { items: [{ isDone: true }, { isDone: false }] },           // 1/2
      { items: [{ isDone: true }, { isDone: true }, { isDone: false }] }, // 2/3
    ]);
    expect(result.done).toBe(3);
    expect(result.total).toBe(5);
    expect(result.percent).toBe(60);
  });

  it("returns 100 percent when every item across every checklist is done", () => {
    const result = aggregateCardProgress([
      { items: [{ isDone: true }, { isDone: true }] },
      { items: [{ isDone: true }] },
    ]);
    expect(result).toEqual({ done: 3, total: 3, percent: 100 });
  });
});
