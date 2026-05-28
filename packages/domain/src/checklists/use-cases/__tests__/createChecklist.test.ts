// packages/domain/src/checklists/use-cases/__tests__/createChecklist.test.ts

import { describe, it, expect } from "vitest";

import { createChecklist } from "../createChecklist";
import {
  ChecklistTitleRequiredError,
  ChecklistTitleTooLongError,
  DuplicateChecklistTitleError,
} from "../../errors";
import type {
  BoardId,
  CardId,
  TenantId,
  UserId,
} from "../../../shared/ids";
import type { ChecklistId } from "../../types";
import type { Position } from "../../../ordering/position";

const TENANT_ID    = "11111111-1111-1111-1111-111111111111" as TenantId;
const CARD_ID      = "22222222-2222-2222-2222-222222222222" as CardId;
const BOARD_ID     = "33333333-3333-3333-3333-333333333333" as BoardId;
const USER_ID      = "44444444-4444-4444-4444-444444444444" as UserId;
const NEW_CL       = "55555555-5555-5555-5555-555555555555" as ChecklistId;
const EVENT_ID     = "66666666-6666-6666-6666-666666666666";
const POSITION     = "n" as Position;
const NOW          = new Date("2026-05-28T10:00:00.000Z");

const baseInput = {
  newChecklistId: NEW_CL,
  tenantId:       TENANT_ID,
  cardId:         CARD_ID,
  boardId:        BOARD_ID,
  title:          "Acceptance Criteria",
  position:       POSITION,
  createdBy:      USER_ID,
  now:            NOW,
  existingTitlesLower: [] as readonly string[],
  eventId:        EVENT_ID,
};

describe("createChecklist — happy path", () => {
  it("returns entity + event with the trimmed title", () => {
    const out = createChecklist({ ...baseInput, title: "  Acceptance Criteria  " });

    expect(out.entity).toMatchObject({
      id:        NEW_CL,
      tenantId:  TENANT_ID,
      cardId:    CARD_ID,
      boardId:   BOARD_ID,
      title:     "Acceptance Criteria",
      position:  POSITION,
      createdAt: NOW,
      createdBy: USER_ID,
      updatedAt: NOW,
      deletedAt: null,
    });

    expect(out.event.type).toBe("checklist.created");
    expect(out.event.schemaVersion).toBe(2);
    expect(out.event.aggregateId).toBe(CARD_ID);
    expect(out.event.aggregateType).toBe("card");
    expect(out.event.tenantId).toBe(TENANT_ID);
    expect(out.event.actorId).toBe(USER_ID);
    expect(out.event.occurredAt).toBe("2026-05-28T10:00:00.000Z");
    expect(out.event.payload).toEqual({
      checklistId: NEW_CL,
      cardId:      CARD_ID,
      boardId:     BOARD_ID,
      title:       "Acceptance Criteria",
      position:    POSITION,
      createdBy:   USER_ID,
    });
  });

  it("accepts Persian titles", () => {
    const out = createChecklist({ ...baseInput, title: "موارد پذیرش" });
    expect(out.entity.title).toBe("موارد پذیرش");
    expect(out.event.payload.title).toBe("موارد پذیرش");
  });

  it("propagates correlationId to the event when provided", () => {
    const out = createChecklist({ ...baseInput, correlationId: "corr-xyz" });
    expect(out.event.correlationId).toBe("corr-xyz");
  });
});

describe("createChecklist — validation", () => {
  it("rejects an empty title", () => {
    expect(() => createChecklist({ ...baseInput, title: "   " }))
      .toThrowError(ChecklistTitleRequiredError);
  });

  it("rejects titles longer than 100 characters", () => {
    expect(() => createChecklist({ ...baseInput, title: "a".repeat(101) }))
      .toThrowError(ChecklistTitleTooLongError);
  });

  it("accepts titles exactly at the 100-character limit", () => {
    const hundred = "a".repeat(100);
    const out = createChecklist({ ...baseInput, title: hundred });
    expect(out.entity.title).toBe(hundred);
  });
});

describe("createChecklist — case-insensitive duplicate detection", () => {
  it("rejects a duplicate that differs only by case", () => {
    expect(() =>
      createChecklist({
        ...baseInput,
        title: "Acceptance Criteria",
        existingTitlesLower: ["acceptance criteria"],
      }),
    ).toThrowError(DuplicateChecklistTitleError);
  });

  it("rejects a Persian duplicate", () => {
    expect(() =>
      createChecklist({
        ...baseInput,
        title: "موارد پذیرش",
        existingTitlesLower: ["موارد پذیرش"],
      }),
    ).toThrowError(DuplicateChecklistTitleError);
  });
});

describe("createChecklist — purity", () => {
  it("two identical inputs produce structurally equal outputs", () => {
    const a = createChecklist(baseInput);
    const b = createChecklist(baseInput);
    expect(a).toEqual(b);
  });

  it("does not mutate its input on the happy path", () => {
    const input = { ...baseInput, title: "Different", existingTitlesLower: ["other"] };
    const before = JSON.stringify(input);
    createChecklist(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not mutate its input even when validation throws", () => {
    const input = {
      ...baseInput,
      title: "Acceptance Criteria",
      existingTitlesLower: ["acceptance criteria"],
    };
    const before = JSON.stringify(input);
    expect(() => createChecklist(input)).toThrowError(DuplicateChecklistTitleError);
    expect(JSON.stringify(input)).toBe(before);
  });
});
