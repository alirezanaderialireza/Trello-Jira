// packages/domain/src/assignees/use-cases/__tests__/addAssigneeToCard.test.ts

import { describe, it, expect } from "vitest";
import { addAssigneeToCard, MAX_ASSIGNEES_PER_CARD } from "../addAssigneeToCard";
import {
  AlreadyAssignedError,
  AssigneeNotBoardMemberError,
  CardLockedAssigneeError,
  MaxAssigneesError,
} from "../../errors";
import type { BoardId, CardId, TenantId, UserId } from "../../../shared/ids";

const TENANT_ID   = "11111111-1111-1111-1111-111111111111" as TenantId;
const CARD_ID     = "22222222-2222-2222-2222-222222222222" as CardId;
const BOARD_ID    = "33333333-3333-3333-3333-333333333333" as BoardId;
const ASSIGNEE_ID = "44444444-4444-4444-4444-444444444444" as UserId;
const ASSIGNER_ID = "55555555-5555-5555-5555-555555555555" as UserId;
const EVENT_ID    = "66666666-6666-6666-6666-666666666666";
const NOW         = new Date("2026-06-01T10:00:00.000Z");

const base = {
  cardId:            CARD_ID,
  boardId:           BOARD_ID,
  tenantId:          TENANT_ID,
  assigneeId:        ASSIGNEE_ID,
  assignedBy:        ASSIGNER_ID,
  isCardLocked:      false,
  callerRole:        "MEMBER",
  isAlreadyAssigned: false,
  isBoardMember:     true,
  currentCount:      0,
  now:               NOW,
  eventId:           EVENT_ID,
};

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("addAssigneeToCard — happy path", () => {
  it("returns entity + event on valid add", () => {
    const out = addAssigneeToCard(base);

    expect(out.entity).toMatchObject({
      cardId:     CARD_ID,
      userId:     ASSIGNEE_ID,
      tenantId:   TENANT_ID,
      assignedBy: ASSIGNER_ID,
      assignedAt: NOW,
    });

    expect(out.event.type).toBe("card.assignee_added");
    expect(out.event.schemaVersion).toBe(2);
    expect(out.event.aggregateId).toBe(CARD_ID);
    expect(out.event.aggregateType).toBe("card");
    expect(out.event.actorId).toBe(ASSIGNER_ID);
    expect(out.event.payload).toEqual({
      cardId:     CARD_ID,
      boardId:    BOARD_ID,
      assigneeId: ASSIGNEE_ID,
      assignedBy: ASSIGNER_ID,
    });
  });

  it("allows self-assign (assignee === assigner)", () => {
    const out = addAssigneeToCard({ ...base, assigneeId: ASSIGNER_ID });
    expect(out.entity.userId).toBe(ASSIGNER_ID);
  });

  it("allows ADMIN to assign on a locked card", () => {
    const out = addAssigneeToCard({
      ...base, isCardLocked: true, callerRole: "ADMIN",
    });
    expect(out.entity.userId).toBe(ASSIGNEE_ID);
  });

  it("allows OWNER to assign on a locked card", () => {
    const out = addAssigneeToCard({
      ...base, isCardLocked: true, callerRole: "OWNER",
    });
    expect(out.entity.userId).toBe(ASSIGNEE_ID);
  });

  it("propagates correlationId to event", () => {
    const out = addAssigneeToCard({ ...base, correlationId: "corr-xyz" });
    expect(out.event.correlationId).toBe("corr-xyz");
  });
});

// ─── Guard: non-member ────────────────────────────────────────────────────────

describe("addAssigneeToCard — non-board-member rejection", () => {
  it("throws AssigneeNotBoardMemberError", () => {
    expect(() =>
      addAssigneeToCard({ ...base, isBoardMember: false }),
    ).toThrowError(AssigneeNotBoardMemberError);
  });
});

// ─── Guard: duplicate ────────────────────────────────────────────────────────

describe("addAssigneeToCard — duplicate rejection", () => {
  it("throws AlreadyAssignedError", () => {
    expect(() =>
      addAssigneeToCard({ ...base, isAlreadyAssigned: true }),
    ).toThrowError(AlreadyAssignedError);
  });
});

// ─── Guard: card locked ───────────────────────────────────────────────────────

describe("addAssigneeToCard — card locked", () => {
  it("throws CardLockedAssigneeError for MEMBER", () => {
    expect(() =>
      addAssigneeToCard({ ...base, isCardLocked: true, callerRole: "MEMBER" }),
    ).toThrowError(CardLockedAssigneeError);
  });
});

// ─── Guard: max assignees ────────────────────────────────────────────────────

describe("addAssigneeToCard — max assignees", () => {
  it("throws MaxAssigneesError when currentCount equals cap", () => {
    expect(() =>
      addAssigneeToCard({ ...base, currentCount: MAX_ASSIGNEES_PER_CARD }),
    ).toThrowError(MaxAssigneesError);
  });

  it("succeeds when one below the cap", () => {
    const out = addAssigneeToCard({ ...base, currentCount: MAX_ASSIGNEES_PER_CARD - 1 });
    expect(out.entity.userId).toBe(ASSIGNEE_ID);
  });
});

// ─── Purity ───────────────────────────────────────────────────────────────────

describe("addAssigneeToCard — purity", () => {
  it("two identical inputs produce structurally equal outputs", () => {
    expect(addAssigneeToCard(base)).toEqual(addAssigneeToCard(base));
  });

  it("does not mutate its input", () => {
    const input = { ...base };
    const before = JSON.stringify(input);
    addAssigneeToCard(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
