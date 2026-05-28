// packages/domain/src/labels/use-cases/__tests__/createLabel.test.ts

import { describe, it, expect } from "vitest";

import { createLabel } from "../createLabel";
import {
  DuplicateLabelNameError,
  InvalidColorTokenError,
  LabelNameRequiredError,
  LabelNameTooLongError,
} from "../../errors";
import type { BoardId, TenantId, UserId } from "../../../shared/ids";
import type { LabelId } from "../../types";
import type { Position } from "../../../ordering/position";

const TENANT_ID  = "11111111-1111-1111-1111-111111111111" as TenantId;
const BOARD_ID   = "22222222-2222-2222-2222-222222222222" as BoardId;
const USER_ID    = "33333333-3333-3333-3333-333333333333" as UserId;
const NEW_LABEL  = "44444444-4444-4444-4444-444444444444" as LabelId;
const EVENT_ID   = "55555555-5555-5555-5555-555555555555";
const POSITION   = "n" as Position;
const NOW        = new Date("2026-05-28T10:00:00.000Z");

const baseInput = {
  newLabelId: NEW_LABEL,
  tenantId:   TENANT_ID,
  boardId:    BOARD_ID,
  name:       "Bug",
  colorToken: "red.500",
  position:   POSITION,
  createdBy:  USER_ID,
  now:        NOW,
  existingNamesLower: [] as readonly string[],
  eventId:    EVENT_ID,
};

describe("createLabel — happy path", () => {
  it("returns entity + event with the trimmed name", () => {
    const out = createLabel({ ...baseInput, name: "  Bug  " });

    expect(out.entity).toMatchObject({
      id:         NEW_LABEL,
      tenantId:   TENANT_ID,
      boardId:    BOARD_ID,
      name:       "Bug",
      colorToken: "red.500",
      position:   POSITION,
      createdAt:  NOW,
      createdBy:  USER_ID,
      updatedAt:  NOW,
      deletedAt:  null,
    });

    expect(out.event.type).toBe("label.created");
    expect(out.event.schemaVersion).toBe(2);
    expect(out.event.aggregateId).toBe(BOARD_ID);
    expect(out.event.aggregateType).toBe("board");
    expect(out.event.tenantId).toBe(TENANT_ID);
    expect(out.event.actorId).toBe(USER_ID);
    expect(out.event.occurredAt).toBe("2026-05-28T10:00:00.000Z");
    expect(out.event.payload).toEqual({
      labelId:    NEW_LABEL,
      boardId:    BOARD_ID,
      name:       "Bug",
      colorToken: "red.500",
      position:   POSITION,
      createdBy:  USER_ID,
    });
  });

  it("accepts Persian names", () => {
    const out = createLabel({ ...baseInput, name: "رفع باگ" });
    expect(out.entity.name).toBe("رفع باگ");
    expect(out.event.payload.name).toBe("رفع باگ");
  });

  it("accepts emoji-prefixed names", () => {
    const out = createLabel({ ...baseInput, name: "🐛 رفع باگ" });
    expect(out.entity.name).toBe("🐛 رفع باگ");
  });

  it("propagates correlationId to the event when provided", () => {
    const out = createLabel({ ...baseInput, correlationId: "corr-xyz" });
    expect(out.event.correlationId).toBe("corr-xyz");
  });
});

describe("createLabel — validation", () => {
  it("rejects an empty name", () => {
    expect(() => createLabel({ ...baseInput, name: "   " }))
      .toThrowError(LabelNameRequiredError);
  });

  it("rejects names longer than 50 characters", () => {
    expect(() => createLabel({ ...baseInput, name: "a".repeat(51) }))
      .toThrowError(LabelNameTooLongError);
  });

  it("accepts names exactly at the 50-character limit", () => {
    const fifty = "a".repeat(50);
    const out = createLabel({ ...baseInput, name: fifty });
    expect(out.entity.name).toBe(fifty);
  });

  it("rejects an invalid colour token", () => {
    expect(() => createLabel({ ...baseInput, colorToken: "fuchsia.500" }))
      .toThrowError(InvalidColorTokenError);
  });

  it("rejects hex colour strings (would slip past with a string type)", () => {
    expect(() => createLabel({ ...baseInput, colorToken: "#FF0000" }))
      .toThrowError(InvalidColorTokenError);
  });

  it("rejects 'black' typo (must be the literal token, no .500 suffix)", () => {
    // 'black' is valid; 'black.500' should be rejected — guards against
    // a future palette refactor where someone copy-pastes the .500 stub.
    expect(() => createLabel({ ...baseInput, colorToken: "black.500" }))
      .toThrowError(InvalidColorTokenError);
  });
});

describe("createLabel — case-insensitive duplicate detection", () => {
  it("rejects a duplicate that differs only by case", () => {
    expect(() =>
      createLabel({
        ...baseInput,
        name: "Bug",
        existingNamesLower: ["bug"],
      }),
    ).toThrowError(DuplicateLabelNameError);
  });

  it("rejects a Persian duplicate", () => {
    expect(() =>
      createLabel({
        ...baseInput,
        name: "رفع باگ",
        existingNamesLower: ["رفع باگ"],
      }),
    ).toThrowError(DuplicateLabelNameError);
  });

  it("allows a name that differs in trimming when caller's list is normalised", () => {
    // caller pre-trimmed and lower-cased. createLabel trims input too.
    const out = createLabel({
      ...baseInput,
      name: "  Feature  ",
      existingNamesLower: ["bug", "in progress"],
    });
    expect(out.entity.name).toBe("Feature");
  });
});

describe("createLabel — purity", () => {
  it("two identical inputs produce structurally equal outputs", () => {
    const a = createLabel(baseInput);
    const b = createLabel(baseInput);
    expect(a).toEqual(b);
  });

  it("does not mutate its input on the happy path", () => {
    const input = { ...baseInput, name: "Feature", existingNamesLower: ["bug"] };
    const before = JSON.stringify(input);
    createLabel(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not mutate its input even when validation throws", () => {
    // name="Bug" + existingNamesLower=["bug"] triggers
    // DuplicateLabelNameError after the toLocaleLowerCase fold.
    // Purity must hold on the error path too — otherwise a partially-
    // applied side effect could leak across tests in a test runner that
    // shares object references.
    const input = { ...baseInput, existingNamesLower: ["bug"] };
    const before = JSON.stringify(input);
    expect(() => createLabel(input)).toThrowError(DuplicateLabelNameError);
    expect(JSON.stringify(input)).toBe(before);
  });
});
