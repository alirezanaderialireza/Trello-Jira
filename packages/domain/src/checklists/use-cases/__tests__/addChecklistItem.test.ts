// packages/domain/src/checklists/use-cases/__tests__/addChecklistItem.test.ts

import { describe, it, expect } from "vitest";

import { addChecklistItem } from "../addChecklistItem";
import {
  ChecklistItemTextRequiredError,
  ChecklistItemTextTooLongError,
} from "../../errors";
import type {
  BoardId,
  CardId,
  TenantId,
  UserId,
} from "../../../shared/ids";
import type {
  ChecklistEntity,
  ChecklistId,
  ChecklistItemId,
} from "../../types";
import type { Position } from "../../../ordering/position";

const TENANT_ID = "11111111-1111-1111-1111-111111111111" as TenantId;
const BOARD_ID  = "22222222-2222-2222-2222-222222222222" as BoardId;
const CARD_ID   = "33333333-3333-3333-3333-333333333333" as CardId;
const CL_ID     = "44444444-4444-4444-4444-444444444444" as ChecklistId;
const ITEM_ID   = "55555555-5555-5555-5555-555555555555" as ChecklistItemId;
const USER_ID   = "66666666-6666-6666-6666-666666666666" as UserId;
const EVENT_ID  = "77777777-7777-7777-7777-777777777777";
const NOW       = new Date("2026-05-28T11:30:00.000Z");

const checklist: ChecklistEntity = {
  id:        CL_ID,
  tenantId:  TENANT_ID,
  cardId:    CARD_ID,
  boardId:   BOARD_ID,
  title:     "Acceptance",
  position:  "n" as Position,
  createdAt: new Date("2026-05-01"),
  createdBy: USER_ID,
  updatedAt: new Date("2026-05-01"),
  deletedAt: null,
};

const baseInput = {
  newItemId:  ITEM_ID,
  checklist,
  text:       "Run the unit tests",
  position:   "p" as Position,
  addedBy:    USER_ID,
  now:        NOW,
  eventId:    EVENT_ID,
};

describe("addChecklistItem — happy path", () => {
  it("returns entity + event with the trimmed text", () => {
    const out = addChecklistItem({ ...baseInput, text: "  Run the unit tests  " });

    expect(out.entity).toMatchObject({
      id:          ITEM_ID,
      tenantId:    TENANT_ID,
      checklistId: CL_ID,
      text:        "Run the unit tests",
      isDone:      false,
      position:    "p",
      createdAt:   NOW,
      createdBy:   USER_ID,
      updatedAt:   NOW,
    });

    expect(out.event.type).toBe("checklist.item_added");
    expect(out.event.schemaVersion).toBe(2);
    expect(out.event.aggregateId).toBe(CARD_ID);
    expect(out.event.aggregateType).toBe("card");
    expect(out.event.payload).toEqual({
      checklistItemId: ITEM_ID,
      checklistId:     CL_ID,
      cardId:          CARD_ID,
      boardId:         BOARD_ID,
      text:            "Run the unit tests",
      isDone:          false,
      position:        "p",
      addedBy:         USER_ID,
    });
  });

  it("accepts Persian text", () => {
    const out = addChecklistItem({ ...baseInput, text: "اجرای تست‌های واحد" });
    expect(out.entity.text).toBe("اجرای تست‌های واحد");
    expect(out.event.payload.text).toBe("اجرای تست‌های واحد");
  });

  it("propagates correlationId to the event when provided", () => {
    const out = addChecklistItem({ ...baseInput, correlationId: "corr-1" });
    expect(out.event.correlationId).toBe("corr-1");
  });
});

describe("addChecklistItem — validation", () => {
  it("rejects empty text", () => {
    expect(() => addChecklistItem({ ...baseInput, text: "   " }))
      .toThrowError(ChecklistItemTextRequiredError);
  });

  it("rejects text longer than 500 characters", () => {
    expect(() => addChecklistItem({ ...baseInput, text: "a".repeat(501) }))
      .toThrowError(ChecklistItemTextTooLongError);
  });

  it("accepts text exactly at the 500-character limit", () => {
    const fiveHundred = "a".repeat(500);
    const out = addChecklistItem({ ...baseInput, text: fiveHundred });
    expect(out.entity.text).toBe(fiveHundred);
  });
});

describe("addChecklistItem — purity", () => {
  it("two identical inputs produce structurally equal outputs", () => {
    const a = addChecklistItem(baseInput);
    const b = addChecklistItem(baseInput);
    expect(a).toEqual(b);
  });

  it("does not mutate its input", () => {
    const input = { ...baseInput };
    const before = JSON.stringify(input);
    addChecklistItem(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
