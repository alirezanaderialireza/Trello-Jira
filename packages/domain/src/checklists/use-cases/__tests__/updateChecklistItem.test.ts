// packages/domain/src/checklists/use-cases/__tests__/updateChecklistItem.test.ts

import { describe, it, expect } from "vitest";

import { updateChecklistItem } from "../updateChecklistItem";
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
  ChecklistItemEntity,
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
const NOW       = new Date("2026-05-28T12:00:00.000Z");

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

const item: ChecklistItemEntity = {
  id:          ITEM_ID,
  tenantId:    TENANT_ID,
  checklistId: CL_ID,
  text:        "Original text",
  isDone:      false,
  position:    "p" as Position,
  createdAt:   new Date("2026-05-01"),
  createdBy:   USER_ID,
  updatedAt:   new Date("2026-05-01"),
};

const baseInput = {
  current:    item,
  checklist,
  patch:      {},
  actorId:    USER_ID,
  now:        NOW,
  eventId:    EVENT_ID,
};

describe("updateChecklistItem — happy path", () => {
  it("returns patch + event when text changes", () => {
    const out = updateChecklistItem({
      ...baseInput,
      patch: { text: "Updated text" },
    });

    expect(out.noOp).toBe(false);
    expect(out.patch).toEqual({ text: "Updated text" });
    expect(out.event.type).toBe("checklist.item_updated");
    expect(out.event.schemaVersion).toBe(2);
    expect(out.event.payload).toEqual({
      checklistItemId: ITEM_ID,
      checklistId:     CL_ID,
      cardId:          CARD_ID,
      boardId:         BOARD_ID,
      changes:         { text: "Updated text" },
    });
  });

  it("toggles isDone (D10 — same procedure, no separate toggle)", () => {
    const out = updateChecklistItem({
      ...baseInput,
      patch: { isDone: true },
    });

    expect(out.noOp).toBe(false);
    expect(out.patch).toEqual({ isDone: true });
    expect(out.event.payload.changes).toEqual({ isDone: true });
  });

  it("reorders via position (D11 — same procedure)", () => {
    const out = updateChecklistItem({
      ...baseInput,
      patch: { position: "z" as Position },
    });

    expect(out.noOp).toBe(false);
    expect(out.patch).toEqual({ position: "z" });
    expect(out.event.payload.changes).toEqual({ position: "z" });
  });

  it("can change all three fields in one call", () => {
    const out = updateChecklistItem({
      ...baseInput,
      patch: {
        text:     "New text",
        isDone:   true,
        position: "z" as Position,
      },
    });

    expect(out.noOp).toBe(false);
    expect(out.patch).toEqual({
      text:     "New text",
      isDone:   true,
      position: "z",
    });
    expect(out.event.payload.changes).toEqual({
      text:     "New text",
      isDone:   true,
      position: "z",
    });
  });
});

describe("updateChecklistItem — no-op detection", () => {
  it("returns noOp when patch is empty", () => {
    const out = updateChecklistItem({ ...baseInput, patch: {} });
    expect(out.noOp).toBe(true);
    expect(out.patch).toEqual({});
  });

  it("returns noOp when text equals current text (after trim)", () => {
    const out = updateChecklistItem({
      ...baseInput,
      patch: { text: "  Original text  " },
    });
    expect(out.noOp).toBe(true);
  });

  it("returns noOp when isDone equals current isDone", () => {
    const out = updateChecklistItem({
      ...baseInput,
      patch: { isDone: false },
    });
    expect(out.noOp).toBe(true);
  });

  it("returns noOp when position equals current position", () => {
    const out = updateChecklistItem({
      ...baseInput,
      patch: { position: "p" as Position },
    });
    expect(out.noOp).toBe(true);
  });
});

describe("updateChecklistItem — validation", () => {
  it("rejects empty text", () => {
    expect(() =>
      updateChecklistItem({ ...baseInput, patch: { text: "   " } }),
    ).toThrowError(ChecklistItemTextRequiredError);
  });

  it("rejects text longer than 500 chars", () => {
    expect(() =>
      updateChecklistItem({ ...baseInput, patch: { text: "a".repeat(501) } }),
    ).toThrowError(ChecklistItemTextTooLongError);
  });
});

describe("updateChecklistItem — purity", () => {
  it("two identical inputs produce structurally equal outputs", () => {
    const a = updateChecklistItem({ ...baseInput, patch: { text: "X" } });
    const b = updateChecklistItem({ ...baseInput, patch: { text: "X" } });
    expect(a).toEqual(b);
  });

  it("does not mutate its input on the happy path", () => {
    const input = { ...baseInput, patch: { text: "X" } };
    const before = JSON.stringify(input);
    updateChecklistItem(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
