// apps/web/src/features/board/store/__tests__/phase0/sequence.test.ts
//
// Phase-0 sequence utility tests.

import { describe, it, expect } from "vitest";
import {
  parseSequence,
  sequenceToString,
  compareSequences,
  isContiguous,
  isNewer,
  isStaleOrDuplicate,
} from "../../event-application/sequence";

describe("parseSequence", () => {
  it("parses valid decimal strings", () => {
    expect(parseSequence("0")).toBe(0n);
    expect(parseSequence("1")).toBe(1n);
    expect(parseSequence("9999999999999999")).toBe(9999999999999999n);
  });

  it("returns 0n for empty string", () => {
    expect(parseSequence("")).toBe(0n);
  });

  it("returns 0n for undefined/null", () => {
    expect(parseSequence(undefined)).toBe(0n);
    expect(parseSequence(null)).toBe(0n);
  });

  it("returns 0n for float strings (non-integer)", () => {
    expect(parseSequence("1.5")).toBe(0n);
    expect(parseSequence("1e5")).toBe(0n);
  });

  it("returns 0n for non-numeric strings", () => {
    expect(parseSequence("abc")).toBe(0n);
    expect(parseSequence("NaN")).toBe(0n);
  });

  it("returns 0n for negative numbers", () => {
    expect(parseSequence("-1")).toBe(0n);
    expect(parseSequence("-999")).toBe(0n);
  });

  it("handles leading zeros (canonical numeric parsing)", () => {
    expect(parseSequence("00042")).toBe(42n);
    expect(parseSequence("007")).toBe(7n);
    expect(parseSequence("0")).toBe(0n);
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseSequence("  42  ")).toBe(42n);
  });
});

describe("sequenceToString", () => {
  it("converts bigint to decimal string", () => {
    expect(sequenceToString(0n)).toBe("0");
    expect(sequenceToString(12345n)).toBe("12345");
  });
});

describe("compareSequences", () => {
  it("returns negative when a < b", () => {
    expect(compareSequences("1", "2")).toBeLessThan(0);
  });
  it("returns 0 when a === b", () => {
    expect(compareSequences("5", "5")).toBe(0);
  });
  it("returns positive when a > b", () => {
    expect(compareSequences("10", "2")).toBeGreaterThan(0);
  });
  it("handles large numbers correctly (no float precision loss)", () => {
    expect(compareSequences("9007199254740993", "9007199254740992")).toBeGreaterThan(0);
  });
});

describe("isContiguous", () => {
  it("returns true when incoming = current + 1", () => {
    expect(isContiguous("100", "101")).toBe(true);
  });
  it("returns false for gap (current=100, incoming=102)", () => {
    expect(isContiguous("100", "102")).toBe(false);
  });
  it("returns false for duplicate (same sequence)", () => {
    expect(isContiguous("100", "100")).toBe(false);
  });
  it("returns false for stale (incoming < current)", () => {
    expect(isContiguous("100", "99")).toBe(false);
  });
});

describe("isNewer", () => {
  it("returns true when incoming > current", () => {
    expect(isNewer("5", "6")).toBe(true);
  });
  it("returns false when incoming === current", () => {
    expect(isNewer("5", "5")).toBe(false);
  });
  it("returns false when incoming < current", () => {
    expect(isNewer("5", "4")).toBe(false);
  });
});

describe("isStaleOrDuplicate", () => {
  it("returns true for duplicate (same sequence)", () => {
    expect(isStaleOrDuplicate("100", "100")).toBe(true);
  });
  it("returns true for stale (incoming < current)", () => {
    expect(isStaleOrDuplicate("100", "99")).toBe(true);
  });
  it("returns false for fresh event (incoming > current)", () => {
    expect(isStaleOrDuplicate("100", "101")).toBe(false);
  });
  it("handles invalid input gracefully (both parse to 0 → equal → stale)", () => {
    expect(isStaleOrDuplicate("", "")).toBe(true);
  });
});
