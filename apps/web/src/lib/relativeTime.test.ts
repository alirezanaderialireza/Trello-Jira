// apps/web/src/lib/relativeTime.test.ts

import { describe, it, expect } from "vitest";
import { formatRelative, formatAbsolute } from "./relativeTime";

// Frozen reference: 2025-06-15T12:00:00.000Z
const NOW = "2025-06-15T12:00:00.000Z";

function ago(seconds: number): string {
  return new Date(new Date(NOW).getTime() - seconds * 1000).toISOString();
}

describe("formatRelative", () => {
  it("returns «الان» for 0 seconds ago", () => {
    expect(formatRelative(NOW, NOW)).toBe("الان");
  });

  it("returns «الان» for 30 seconds ago", () => {
    expect(formatRelative(ago(30), NOW)).toBe("الان");
  });

  it("returns «الان» for 59 seconds ago (boundary)", () => {
    expect(formatRelative(ago(59), NOW)).toBe("الان");
  });

  it("returns «۱ دقیقه پیش» for exactly 60 seconds ago", () => {
    expect(formatRelative(ago(60), NOW)).toBe("۱ دقیقه پیش");
  });

  it("returns minutes for 30 min ago", () => {
    expect(formatRelative(ago(30 * 60), NOW)).toBe("۳۰ دقیقه پیش");
  });

  it("returns «۱ ساعت پیش» for exactly 1 h boundary", () => {
    expect(formatRelative(ago(60 * 60), NOW)).toBe("۱ ساعت پیش");
  });

  it("returns hours for 3 h ago", () => {
    expect(formatRelative(ago(3 * 3600), NOW)).toBe("۳ ساعت پیش");
  });

  it("returns «دیروز» for 25 h ago (between 24h and 48h)", () => {
    expect(formatRelative(ago(25 * 3600), NOW)).toBe("دیروز");
  });

  it("returns «۳ روز پیش» for 3 days ago", () => {
    expect(formatRelative(ago(3 * 86400), NOW)).toBe("۳ روز پیش");
  });

  it("returns «۶ روز پیش» for 6 days ago", () => {
    expect(formatRelative(ago(6 * 86400), NOW)).toBe("۶ روز پیش");
  });

  it("returns absolute Jalali for 7 days ago (>= week threshold)", () => {
    const result = formatRelative(ago(7 * 86400), NOW);
    // Should be a Jalali display, not a relative string
    expect(result).not.toContain("پیش");
    expect(result.length).toBeGreaterThan(4);
  });
});

describe("formatAbsolute", () => {
  it("returns a non-empty Jalali string for a valid ISO date", () => {
    const result = formatAbsolute("2025-06-15T10:30:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(5);
  });
});
