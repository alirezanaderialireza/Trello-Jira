// packages/domain/src/labels/use-cases/__tests__/applyLabelToCard.test.ts

import { describe, it, expect } from "vitest";

import { applyLabelToCard } from "../applyLabelToCard";
import { LabelBoardMismatchError } from "../../errors";
import type { BoardId, CardId, TenantId, UserId } from "../../../shared/ids";
import type { LabelId, LabelEntity } from "../../types";
import type { Position } from "../../../ordering/position";

const TENANT_ID = "11111111-1111-1111-1111-111111111111" as TenantId;
const BOARD_ID  = "22222222-2222-2222-2222-222222222222" as BoardId;
const OTHER_BOARD_ID = "99999999-9999-9999-9999-999999999999" as BoardId;
const CARD_ID   = "33333333-3333-3333-3333-333333333333" as CardId;
const LABEL_ID  = "44444444-4444-4444-4444-444444444444" as LabelId;
const USER_ID   = "55555555-5555-5555-5555-555555555555" as UserId;
const EVENT_ID  = "66666666-6666-6666-6666-666666666666";
const NOW       = new Date("2026-05-28T11:30:00.000Z");

const label: LabelEntity = {
  id:         LABEL_ID,
  tenantId:   TENANT_ID,
  boardId:    BOARD_ID,
  name:       "Bug",
  colorToken: "red.500",
  position:   "n" as Position,
  createdAt:  new Date("2026-05-01"),
  createdBy:  USER_ID,
  updatedAt:  new Date("2026-05-01"),
  deletedAt:  null,
};

const baseInput = {
  cardId: CARD_ID,
  card: { id: CARD_ID, boardId: BOARD_ID, tenantId: TENANT_ID },
  label,
  appliedBy: USER_ID,
  now: NOW,
  eventId: EVENT_ID,
  alreadyApplied: false,
};

describe("applyLabelToCard — happy path", () => {
  it("returns link + event when the label is not yet applied", () => {
    const out = applyLabelToCard(baseInput);

    expect(out.noOp).toBe(false);
    expect(out.link).toEqual({
      cardId:    CARD_ID,
      labelId:   LABEL_ID,
      tenantId:  TENANT_ID,
      appliedBy: USER_ID,
      appliedAt: NOW,
    });

    expect(out.event?.type).toBe("card.label_added");
    expect(out.event?.schemaVersion).toBe(2);
    expect(out.event?.aggregateId).toBe(CARD_ID);
    expect(out.event?.aggregateType).toBe("card");
    expect(out.event?.payload).toEqual({
      cardId:    CARD_ID,
      boardId:   BOARD_ID,
      labelId:   LABEL_ID,
      appliedBy: USER_ID,
    });
  });

  it("propagates correlationId", () => {
    const out = applyLabelToCard({ ...baseInput, correlationId: "corr-1" });
    expect(out.event?.correlationId).toBe("corr-1");
  });
});

describe("applyLabelToCard — idempotency (EC2)", () => {
  it("returns noOp when the link already exists", () => {
    const out = applyLabelToCard({ ...baseInput, alreadyApplied: true });
    expect(out).toEqual({ noOp: true });
  });

  it("noOp output omits link and event so caller skips DB write + outbox emit", () => {
    const out = applyLabelToCard({ ...baseInput, alreadyApplied: true });
    expect(out.link).toBeUndefined();
    expect(out.event).toBeUndefined();
  });
});

describe("applyLabelToCard — topology guard", () => {
  it("rejects a label from a different board", () => {
    const otherBoardLabel: LabelEntity = { ...label, boardId: OTHER_BOARD_ID };
    expect(() =>
      applyLabelToCard({ ...baseInput, label: otherBoardLabel }),
    ).toThrowError(LabelBoardMismatchError);
  });

  it("topology check runs even when alreadyApplied is true (defence in depth)", () => {
    // If alreadyApplied + cross-board ever co-occurs, that's a corruption
    // we should surface, not silently noOp.
    const otherBoardLabel: LabelEntity = { ...label, boardId: OTHER_BOARD_ID };
    expect(() =>
      applyLabelToCard({
        ...baseInput,
        label: otherBoardLabel,
        alreadyApplied: true,
      }),
    ).toThrowError(LabelBoardMismatchError);
  });
});

describe("applyLabelToCard — purity", () => {
  it("two identical inputs produce structurally equal outputs", () => {
    const a = applyLabelToCard(baseInput);
    const b = applyLabelToCard(baseInput);
    expect(a).toEqual(b);
  });
});
