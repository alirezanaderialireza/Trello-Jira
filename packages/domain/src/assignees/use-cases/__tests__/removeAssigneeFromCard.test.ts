// packages/domain/src/assignees/use-cases/__tests__/removeAssigneeFromCard.test.ts

import { describe, it, expect } from "vitest";
import { removeAssigneeFromCard } from "../removeAssigneeFromCard";
import {
  CardLockedAssigneeError,
  NotAssignedError,
} from "../../errors";
import type { BoardId, CardId, TenantId, UserId } from "../../../shared/ids";

const TENANT_ID   = "11111111-1111-1111-1111-111111111111" as TenantId;
const CARD_ID     = "22222222-2222-2222-2222-222222222222" as CardId;
const BOARD_ID    = "33333333-3333-3333-3333-333333333333" as BoardId;
const ASSIGNEE_ID = "44444444-4444-4444-4444-444444444444" as UserId;
const REMOVER_ID  = "55555555-5555-5555-5555-555555555555" as UserId;
const EVENT_ID    = "66666666-6666-6666-6666-666666666666";
const NOW         = new Date("2026-06-01T10:00:00.000Z");

const base = {
  cardId:       CARD_ID,
  boardId:      BOARD_ID,
  tenantId:     TENANT_ID,
  assigneeId:   ASSIGNEE_ID,
  removedBy:    REMOVER_ID,
  isCardLocked: false,
  callerRole:   "MEMBER",
  isAssigned:   true,
  now:          NOW,
  eventId:      EVENT_ID,
};

describe("removeAssigneeFromCard — happy path", () => {
  it("returns event with v2 payload", () => {
    const out = removeAssigneeFromCard(base);

    expect(out.event.type).toBe("card.assignee_removed");
    expect(out.event.schemaVersion).toBe(2);
    expect(out.event.aggregateId).toBe(CARD_ID);
    expect(out.event.actorId).toBe(REMOVER_ID);
    expect(out.event.payload).toEqual({
      cardId:     CARD_ID,
      boardId:    BOARD_ID,
      assigneeId: ASSIGNEE_ID,
      removedBy:  REMOVER_ID,
    });
  });

  it("allows ADMIN to remove on locked card", () => {
    const out = removeAssigneeFromCard({
      ...base, isCardLocked: true, callerRole: "ADMIN",
    });
    expect(out.event.type).toBe("card.assignee_removed");
  });
});

describe("removeAssigneeFromCard — guards", () => {
  it("throws NotAssignedError when isAssigned=false", () => {
    expect(() =>
      removeAssigneeFromCard({ ...base, isAssigned: false }),
    ).toThrowError(NotAssignedError);
  });

  it("throws CardLockedAssigneeError for MEMBER on locked card", () => {
    expect(() =>
      removeAssigneeFromCard({ ...base, isCardLocked: true, callerRole: "MEMBER" }),
    ).toThrowError(CardLockedAssigneeError);
  });
});

describe("removeAssigneeFromCard — purity", () => {
  it("two identical inputs produce structurally equal outputs", () => {
    expect(removeAssigneeFromCard(base)).toEqual(removeAssigneeFromCard(base));
  });
});
