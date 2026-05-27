// packages/domain/src/board/use-cases/__tests__/addBoardMember.test.ts

import { describe, it, expect } from "vitest";
import { addBoardMember } from "../addBoardMember";

const CALLER = "11111111-1111-1111-1111-111111111111";
const TARGET = "22222222-2222-2222-2222-222222222222";
const MEMBER_ROW_ID = "33333333-3333-3333-3333-333333333333";

describe("addBoardMember — invariants", () => {
  it("rejects self-invite", () => {
    const result = addBoardMember({
      callerUserId: CALLER,
      targetUserId: CALLER,
      targetIsWorkspaceMember: true,
      existingMembership: null,
    });
    expect(result).toEqual({ success: false, reason: "SELF_INVITE" });
  });

  it("rejects target who is not a workspace member", () => {
    const result = addBoardMember({
      callerUserId: CALLER,
      targetUserId: TARGET,
      targetIsWorkspaceMember: false,
      existingMembership: null,
    });
    expect(result).toEqual({
      success: false,
      reason: "TARGET_NOT_WORKSPACE_MEMBER",
    });
  });

  it("self-invite check runs before workspace-member check", () => {
    // Even with targetIsWorkspaceMember=false, self-invite wins.
    const result = addBoardMember({
      callerUserId: CALLER,
      targetUserId: CALLER,
      targetIsWorkspaceMember: false,
      existingMembership: null,
    });
    expect(result).toEqual({ success: false, reason: "SELF_INVITE" });
  });
});

describe("addBoardMember — state machine", () => {
  it("returns INSERT_NEW_ROW when no prior membership", () => {
    const result = addBoardMember({
      callerUserId: CALLER,
      targetUserId: TARGET,
      targetIsWorkspaceMember: true,
      existingMembership: null,
    });
    expect(result).toEqual({ success: true, action: "INSERT_NEW_ROW" });
  });

  it("returns ALREADY_ACTIVE_MEMBER when an active row exists", () => {
    const result = addBoardMember({
      callerUserId: CALLER,
      targetUserId: TARGET,
      targetIsWorkspaceMember: true,
      existingMembership: { id: MEMBER_ROW_ID, removedAt: null },
    });
    expect(result).toEqual({
      success: true,
      action: "ALREADY_ACTIVE_MEMBER",
    });
  });

  it("returns REACTIVATE_REMOVED_ROW when a soft-removed row exists", () => {
    const result = addBoardMember({
      callerUserId: CALLER,
      targetUserId: TARGET,
      targetIsWorkspaceMember: true,
      existingMembership: {
        id: MEMBER_ROW_ID,
        removedAt: new Date("2025-01-01T00:00:00Z"),
      },
    });
    expect(result).toEqual({
      success: true,
      action: "REACTIVATE_REMOVED_ROW",
    });
  });
});

describe("addBoardMember — failure reasons take precedence over state", () => {
  it("self-invite beats existing row", () => {
    const result = addBoardMember({
      callerUserId: CALLER,
      targetUserId: CALLER,
      targetIsWorkspaceMember: true,
      existingMembership: { id: MEMBER_ROW_ID, removedAt: null },
    });
    expect(result).toEqual({ success: false, reason: "SELF_INVITE" });
  });

  it("not-workspace-member beats existing row", () => {
    const result = addBoardMember({
      callerUserId: CALLER,
      targetUserId: TARGET,
      targetIsWorkspaceMember: false,
      existingMembership: { id: MEMBER_ROW_ID, removedAt: null },
    });
    expect(result).toEqual({
      success: false,
      reason: "TARGET_NOT_WORKSPACE_MEMBER",
    });
  });
});
