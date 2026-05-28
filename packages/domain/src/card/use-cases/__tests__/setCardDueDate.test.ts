// packages/domain/src/card/use-cases/__tests__/setCardDueDate.test.ts

import { describe, it, expect } from "vitest";

import { setCardDueDate } from "../setCardDueDate";
import type {
  BoardId,
  CardId,
  TenantId,
  UserId,
} from "../../../shared/ids";
import type { DateOnly } from "../../../shared/date-types";

const CARD_ID   = "11111111-1111-1111-1111-111111111111" as CardId;
const BOARD_ID  = "22222222-2222-2222-2222-222222222222" as BoardId;
const TENANT_ID = "33333333-3333-3333-3333-333333333333" as TenantId;
const USER_ID   = "44444444-4444-4444-4444-444444444444" as UserId;
const EVENT_ID  = "55555555-5555-5555-5555-555555555555";
const NOW       = new Date("2026-05-28T10:00:00.000Z");

const MARCH_30 = "2025-03-30" as DateOnly;
const APRIL_15 = "2025-04-15" as DateOnly;

const baseInput = {
  card: {
    id:       CARD_ID,
    boardId:  BOARD_ID,
    tenantId: TENANT_ID,
    dueDate:  null,
  },
  newDueDate: MARCH_30,
  actorId:    USER_ID,
  now:        NOW,
  eventId:    EVENT_ID,
} as const;

describe("setCardDueDate — happy path (set)", () => {
  it("returns patch + event when setting from null → DateOnly", () => {
    const out = setCardDueDate(baseInput);

    expect(out.noOp).toBe(false);
    if (out.noOp) throw new Error("expected noOp=false");

    expect(out.patch).toEqual({ dueDate: MARCH_30 });

    expect(out.event.type).toBe("card.due_date_updated");
    expect(out.event.schemaVersion).toBe(2);
    expect(out.event.aggregateId).toBe(CARD_ID);
    expect(out.event.aggregateType).toBe("card");
    expect(out.event.tenantId).toBe(TENANT_ID);
    expect(out.event.actorId).toBe(USER_ID);
    expect(out.event.occurredAt).toBe("2026-05-28T10:00:00.000Z");
    expect(out.event.payload).toEqual({
      cardId:     CARD_ID,
      boardId:    BOARD_ID,
      oldDueDate: null,
      newDueDate: MARCH_30,
      updatedBy:  USER_ID,
    });
  });

  it("returns patch + event when changing one DateOnly to another", () => {
    const out = setCardDueDate({
      ...baseInput,
      card:       { ...baseInput.card, dueDate: MARCH_30 },
      newDueDate: APRIL_15,
    });

    expect(out.noOp).toBe(false);
    if (out.noOp) throw new Error("expected noOp=false");

    expect(out.patch).toEqual({ dueDate: APRIL_15 });
    expect(out.event.payload.oldDueDate).toBe(MARCH_30);
    expect(out.event.payload.newDueDate).toBe(APRIL_15);
  });

  it("propagates correlationId to the event when provided", () => {
    const out = setCardDueDate({ ...baseInput, correlationId: "corr-xyz" });
    if (out.noOp) throw new Error("expected noOp=false");
    expect(out.event.correlationId).toBe("corr-xyz");
  });
});

describe("setCardDueDate — happy path (clear)", () => {
  it("returns patch + event when clearing from DateOnly → null", () => {
    const out = setCardDueDate({
      ...baseInput,
      card:       { ...baseInput.card, dueDate: MARCH_30 },
      newDueDate: null,
    });

    expect(out.noOp).toBe(false);
    if (out.noOp) throw new Error("expected noOp=false");

    expect(out.patch).toEqual({ dueDate: null });
    expect(out.event.payload).toEqual({
      cardId:     CARD_ID,
      boardId:    BOARD_ID,
      oldDueDate: MARCH_30,
      newDueDate: null,
      updatedBy:  USER_ID,
    });
  });
});

describe("setCardDueDate — idempotency", () => {
  it("returns noOp when current and new are both null", () => {
    const out = setCardDueDate({ ...baseInput, newDueDate: null });
    expect(out).toEqual({ noOp: true });
  });

  it("returns noOp when current and new are the same DateOnly", () => {
    const out = setCardDueDate({
      ...baseInput,
      card:       { ...baseInput.card, dueDate: MARCH_30 },
      newDueDate: MARCH_30,
    });
    expect(out).toEqual({ noOp: true });
  });

  it("noOp output is the discriminator-only shape", () => {
    const out = setCardDueDate({ ...baseInput, newDueDate: null });
    expect(out.noOp).toBe(true);
    // Type-narrowing: in the noOp branch, accessing .patch / .event is
    // a TS error (verified by the discriminated union). Runtime shape
    // matched against toEqual({ noOp: true }) above.
  });
});

describe("setCardDueDate — purity", () => {
  it("two identical inputs produce structurally equal outputs", () => {
    const a = setCardDueDate(baseInput);
    const b = setCardDueDate(baseInput);
    expect(a).toEqual(b);
  });

  it("does not mutate its input on the happy path", () => {
    const input = { ...baseInput };
    const before = JSON.stringify(input);
    setCardDueDate(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not mutate its input on the no-op path", () => {
    const input = { ...baseInput, newDueDate: null };
    const before = JSON.stringify(input);
    setCardDueDate(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
