// apps/web/src/lib/date.test.ts
// 52 tests for the Jalali-aware time engine.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  utcFromServer, dateOnlyFromServer, normalizeToDayUTC, addDays,
  diffDays, isSameDay, isOverdue, nowUIOnly, toJalaliDisplay,
  fromJalaliInput, fromJalaliDateTimeInput,
  type UTCDateTime, type DateOnly,
} from "./date";

// ============================================================================
// F.1 — Setup (Time Freeze)
// ============================================================================

const FROZEN_NOW = new Date("2025-06-15T12:00:00.000Z");

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(FROZEN_NOW); });
afterEach(() => { vi.useRealTimers(); });

// ============================================================================
// F.2 — Server-trusted Factories (5 tests)
// ============================================================================

describe("Server-trusted Factories", () => {
  it("utcFromServer accepts valid ISO", () => {
    expect(utcFromServer("2025-06-15T12:00:00.000Z")).toBe("2025-06-15T12:00:00.000Z");
  });
  it("utcFromServer normalizes to ISO 8601", () => {
    expect(utcFromServer("2025-06-15T12:00:00Z")).toBe("2025-06-15T12:00:00.000Z");
  });
  it("utcFromServer throws on garbage and empty", () => {
    expect(() => utcFromServer("")).toThrow();
    expect(() => utcFromServer("not-a-date")).toThrow();
  });
  it("dateOnlyFromServer accepts YYYY-MM-DD", () => {
    expect(dateOnlyFromServer("2025-03-30")).toBe("2025-03-30");
  });
  it("dateOnlyFromServer throws on wrong format", () => {
    expect(() => dateOnlyFromServer("2025/03/30")).toThrow();
    expect(() => dateOnlyFromServer("30-03-2025")).toThrow();
  });
});

// ============================================================================
// F.3 — UTC Math (7 tests)
// ============================================================================

describe("UTC Math", () => {
  it("normalizeToDayUTC returns 00:00 UTC", () => {
    const r = normalizeToDayUTC("2025-06-15T18:45:00.000Z" as UTCDateTime);
    expect(r).toBe("2025-06-15T00:00:00.000Z");
  });
  it("addDays with 0, +1, -1", () => {
    const base = "2025-06-15T10:00:00.000Z" as UTCDateTime;
    expect(addDays(base, 0)).toBe("2025-06-15T10:00:00.000Z");
    expect(addDays(base, 1)).toBe("2025-06-16T10:00:00.000Z");
    expect(addDays(base, -1)).toBe("2025-06-14T10:00:00.000Z");
  });
  it("addDays crosses month boundary", () => {
    expect(addDays("2025-06-30T10:00:00.000Z" as UTCDateTime, 1)).toBe("2025-07-01T10:00:00.000Z");
  });
  it("addDays handles Gregorian leap year", () => {
    expect(addDays("2024-02-28T10:00:00.000Z" as UTCDateTime, 1)).toBe("2024-02-29T10:00:00.000Z"); // 2024 leap
    expect(addDays("2025-02-28T10:00:00.000Z" as UTCDateTime, 1)).toBe("2025-03-01T10:00:00.000Z"); // 2025 not leap
  });
  it("diffDays is symmetric", () => {
    const a = "2025-06-20T10:00:00.000Z" as UTCDateTime;
    const b = "2025-06-15T10:00:00.000Z" as UTCDateTime;
    expect(diffDays(a, b)).toBe(5);
    expect(diffDays(b, a)).toBe(-5);
  });
  it("diffDays ignores time-of-day", () => {
    const a = "2025-06-15T23:59:59.000Z" as UTCDateTime;
    const b = "2025-06-15T00:00:01.000Z" as UTCDateTime;
    expect(diffDays(a, b)).toBe(0);
  });
  it("isSameDay compares UTC calendar day", () => {
    expect(isSameDay("2025-06-15T00:00:00.000Z" as UTCDateTime, "2025-06-15T23:59:59.000Z" as UTCDateTime)).toBe(true);
    expect(isSameDay("2025-06-15T23:59:59.000Z" as UTCDateTime, "2025-06-16T00:00:00.000Z" as UTCDateTime)).toBe(false);
  });
});

// ============================================================================
// F.4 — isOverdue (5 tests)
// ============================================================================

describe("isOverdue", () => {
  const now = "2025-06-15T12:00:00.000Z" as UTCDateTime;
  it("yesterday → true", () => { expect(isOverdue("2025-06-14T00:00:00.000Z" as UTCDateTime, now)).toBe(true); });
  it("today → false", () => { expect(isOverdue("2025-06-15T00:00:00.000Z" as UTCDateTime, now)).toBe(false); });
  it("tomorrow → false", () => { expect(isOverdue("2025-06-16T00:00:00.000Z" as UTCDateTime, now)).toBe(false); });
  it("uses FROZEN_NOW when no now param", () => { expect(isOverdue("2025-06-14T00:00:00.000Z" as UTCDateTime)).toBe(true); });
  it("ignores time-of-day", () => { expect(isOverdue("2025-06-14T23:59:59.000Z" as UTCDateTime, now)).toBe(true); });
});

// ============================================================================
// F.5 — nowUIOnly (2 tests)
// ============================================================================

describe("nowUIOnly", () => {
  it("returns FROZEN_NOW", () => { expect(nowUIOnly()).toBe("2025-06-15T12:00:00.000Z"); });
  it("updates when system time changes", () => {
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    expect(nowUIOnly()).toBe("2030-01-01T00:00:00.000Z");
  });
});

// ============================================================================
// F.6 — Jalali Parsing — Leap Years (10 tests)
// ============================================================================

describe("Jalali Parsing — Leap Years", () => {
  it("1404/01/10 → 2025-03-30", () => { const r = fromJalaliInput("1404/01/10"); expect(r.ok && r.value).toBe("2025-03-30"); });
  it("1403/12/30 → 2025-03-20 (1403 is leap)", () => { const r = fromJalaliInput("1403/12/30"); expect(r.ok && r.value).toBe("2025-03-20"); });
  it("1404/12/30 → REJECT (1404 not leap)", () => { const r = fromJalaliInput("1404/12/30"); expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toBe("INVALID_JALALI_DATE"); });
  it("1404/12/29 → 2026-03-20 (last day of non-leap year)", () => { const r = fromJalaliInput("1404/12/29"); expect(r.ok && r.value).toBe("2026-03-20"); });
  it("1403/01/01 → 2024-03-20 (Nowruz 1403)", () => { const r = fromJalaliInput("1403/01/01"); expect(r.ok && r.value).toBe("2024-03-20"); });
  it("1404/01/01 → 2025-03-21 (Nowruz 1404)", () => { const r = fromJalaliInput("1404/01/01"); expect(r.ok && r.value).toBe("2025-03-21"); });
  it("1404/13/01 → REJECT (month 13)", () => { const r = fromJalaliInput("1404/13/01"); expect(r.ok).toBe(false); });
  it("1404/06/32 → REJECT (day 32)", () => { const r = fromJalaliInput("1404/06/32"); expect(r.ok).toBe(false); });
  it("1404/07/31 → REJECT (Mehr has 30 days)", () => { const r = fromJalaliInput("1404/07/31"); expect(r.ok).toBe(false); });
  it("1404/01/31 and 1404/06/31 → ACCEPT (months 1-6 have 31 days)", () => {
    expect(fromJalaliInput("1404/01/31").ok).toBe(true);
    expect(fromJalaliInput("1404/06/31").ok).toBe(true);
  });
});

// ============================================================================
// F.7 — Format Input (6 tests)
// ============================================================================

describe("Format Input", () => {
  it("1404/1/5 (no padding) accepted → 2025-03-25", () => { const r = fromJalaliInput("1404/1/5"); expect(r.ok && r.value).toBe("2025-03-25"); });
  it("whitespace trimmed", () => { const r = fromJalaliInput("  1404/01/10  "); expect(r.ok && r.value).toBe("2025-03-30"); });
  it("empty → INVALID_FORMAT", () => { const r = fromJalaliInput(""); expect(!r.ok && r.error).toBe("INVALID_FORMAT"); });
  it("garbage → INVALID_FORMAT", () => { const r = fromJalaliInput("hello"); expect(!r.ok && r.error).toBe("INVALID_FORMAT"); });
  it("Gregorian-like → INVALID_FORMAT", () => { const r = fromJalaliInput("2025-03-30"); expect(!r.ok && r.error).toBe("INVALID_FORMAT"); });
  it("incomplete → REJECT", () => {
    expect(fromJalaliInput("1404/01").ok).toBe(false);
    expect(fromJalaliInput("1404").ok).toBe(false);
  });
});

// ============================================================================
// F.8 — Cross-timezone Consistency (2 tests)
// ============================================================================

describe("Cross-timezone Consistency", () => {
  it("fromJalaliInput is TZ-neutral (same result regardless of user TZ)", () => {
    // DateOnly has no TZ shift
    const r = fromJalaliInput("1404/01/10");
    expect(r.ok && r.value).toBe("2025-03-30");
  });
  it("toJalaliDisplay shows different days for same instant in different TZs", () => {
    const instant = "2025-03-29T22:00:00.000Z" as UTCDateTime;
    // Tehran (+3:30) → 2025-03-30 01:30 → Jalali 1404/01/10
    const tehran = toJalaliDisplay(instant, "Asia/Tehran");
    expect(tehran).toBe("1404/01/10");
    // Berlin (+1:00 or +2:00 DST) → 2025-03-29 23:00 → Jalali 1404/01/09
    const berlin = toJalaliDisplay(instant, "Europe/Berlin");
    expect(berlin).toBe("1404/01/09");
  });
});

// ============================================================================
// F.9 — Display (3 tests)
// ============================================================================

describe("Display", () => {
  it("toJalaliDisplay default format", () => {
    expect(toJalaliDisplay("2025-03-30T00:00:00.000Z" as UTCDateTime, "Asia/Tehran")).toBe("1404/01/10");
  });
  it("toJalaliDisplay with time format (preserves Tehran wall-clock)", () => {
    // 2025-03-30T10:30:00Z → Tehran is +3:30 → 14:00 Tehran
    const result = toJalaliDisplay("2025-03-30T10:30:00.000Z" as UTCDateTime, "Asia/Tehran", "YYYY/MM/DD HH:mm");
    expect(result).toBe("1404/01/10 14:00");
  });
  it("works on DateOnly (assumes UTC midnight)", () => {
    const result = toJalaliDisplay("2025-03-30" as DateOnly, "Asia/Tehran");
    expect(result).toBe("1404/01/10");
  });
});

// ============================================================================
// F.10 — Round-trip Gregorian ↔ Jalali (6 tests)
// ============================================================================

describe("Round-trip Gregorian ↔ Jalali", () => {
  const cases: [string, string][] = [
    ["2024-03-20", "1403/01/01"],
    ["2025-03-20", "1403/12/30"],
    ["2025-03-21", "1404/01/01"],
    ["2025-06-15", "1404/03/25"],
    ["2026-03-20", "1404/12/29"],
    ["2027-03-21", "1406/01/01"],
  ];

  for (const [greg, jalali] of cases) {
    it(`${greg} → Jalali → parse → ${greg}`, () => {
      const dateOnly = dateOnlyFromServer(greg);
      const displayed = toJalaliDisplay(dateOnly, "UTC");
      const parsed = fromJalaliInput(displayed);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value).toBe(greg);
    });
  }
});

// ============================================================================
// F.11 — fromJalaliDateTimeInput (3 tests)
// ============================================================================

describe("fromJalaliDateTimeInput", () => {
  it("1404/01/10 14:00 in Tehran → 2025-03-30T10:30:00.000Z", () => {
    const r = fromJalaliDateTimeInput("1404/01/10 14:00", "Asia/Tehran");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("2025-03-30T10:30:00.000Z");
  });
  it("1404/12/30 14:00 (invalid date) → REJECT", () => {
    const r = fromJalaliDateTimeInput("1404/12/30 14:00", "Asia/Tehran");
    expect(r.ok).toBe(false);
  });
  it("garbage → REJECT", () => {
    expect(fromJalaliDateTimeInput("hello", "Asia/Tehran").ok).toBe(false);
    expect(fromJalaliDateTimeInput("1404/01/10", "Asia/Tehran").ok).toBe(false); // no time
  });
});

// ============================================================================
// F.12 — Branded Types Smoke (2 tests)
// ============================================================================

describe("Branded Types Smoke", () => {
  it("UTCDateTime is a 24-char string at runtime", () => {
    const d = utcFromServer("2025-06-15T12:00:00.000Z");
    expect(typeof d).toBe("string");
    expect(d.length).toBe(24);
  });
  it("DateOnly is a YYYY-MM-DD string at runtime", () => {
    const d = dateOnlyFromServer("2025-03-30");
    expect(typeof d).toBe("string");
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
