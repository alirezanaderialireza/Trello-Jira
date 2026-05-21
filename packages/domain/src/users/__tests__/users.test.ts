// packages/domain/src/users/__tests__/users.test.ts
import { describe, it, expect } from "vitest";
import { normalizeEmail, validatePasswordPolicy } from "../index";

describe("User Domain — Email Normalization", () => {
  it("lowercases email", () => { expect(normalizeEmail("User@Gmail.COM")).toBe("user@gmail.com"); });
  it("trims whitespace", () => { expect(normalizeEmail("  user@test.com  ")).toBe("user@test.com"); });
  it("throws on empty", () => { expect(() => normalizeEmail("")).toThrow(); });
  it("throws on missing @", () => { expect(() => normalizeEmail("invalid")).toThrow(); });
  it("throws on too long (>254)", () => { expect(() => normalizeEmail("a".repeat(250) + "@b.c")).toThrow(); });
});

describe("User Domain — Password Policy", () => {
  it("accepts valid password", () => { expect(validatePasswordPolicy("MyPass123").valid).toBe(true); });
  it("rejects < 8 chars", () => { const r = validatePasswordPolicy("Ab1"); expect(r.valid).toBe(false); expect(r.errors).toContain("Password must be at least 8 characters"); });
  it("rejects > 128 chars", () => { expect(validatePasswordPolicy("A1" + "x".repeat(130)).valid).toBe(false); });
  it("rejects no digit", () => { expect(validatePasswordPolicy("AbcdefghiJ").valid).toBe(false); });
  it("rejects no letter", () => { expect(validatePasswordPolicy("12345678").valid).toBe(false); });
  it("accepts 8 char minimum with digit + letter", () => { expect(validatePasswordPolicy("Abcdefg1").valid).toBe(true); });
});
