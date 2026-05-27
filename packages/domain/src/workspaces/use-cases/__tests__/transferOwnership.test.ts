// packages/domain/src/workspaces/use-cases/__tests__/transferOwnership.test.ts

import { describe, it, expect } from "vitest";
import { transferOwnership } from "../transferOwnership";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const NEW_OWNER_ID = "22222222-2222-2222-2222-222222222222";

describe("transferOwnership — happy path", () => {
  it("succeeds when new owner is a non-OWNER member", () => {
    const result = transferOwnership({
      currentOwnerUserId: OWNER_ID,
      newOwnerUserId: NEW_OWNER_ID,
      newOwnerCurrentRole: "ADMIN",
    });
    expect(result).toEqual({
      success: true,
      currentOwnerNextRole: "ADMIN",
      newOwnerNextRole: "OWNER",
    });
  });

  it("succeeds for any non-OWNER role (MEMBER, VIEWER)", () => {
    const memberResult = transferOwnership({
      currentOwnerUserId: OWNER_ID,
      newOwnerUserId: NEW_OWNER_ID,
      newOwnerCurrentRole: "MEMBER",
    });
    expect(memberResult.success).toBe(true);

    const viewerResult = transferOwnership({
      currentOwnerUserId: OWNER_ID,
      newOwnerUserId: NEW_OWNER_ID,
      newOwnerCurrentRole: "VIEWER",
    });
    expect(viewerResult.success).toBe(true);
  });

  it("the demoted owner becomes ADMIN, never lower", () => {
    const result = transferOwnership({
      currentOwnerUserId: OWNER_ID,
      newOwnerUserId: NEW_OWNER_ID,
      newOwnerCurrentRole: "VIEWER",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.currentOwnerNextRole).toBe("ADMIN");
  });
});

describe("transferOwnership — invariants", () => {
  it("rejects self-transfer", () => {
    const result = transferOwnership({
      currentOwnerUserId: OWNER_ID,
      newOwnerUserId: OWNER_ID,
      newOwnerCurrentRole: "OWNER",
    });
    expect(result).toEqual({ success: false, reason: "SELF_TRANSFER" });
  });

  it("rejects when new owner is not a member (null)", () => {
    const result = transferOwnership({
      currentOwnerUserId: OWNER_ID,
      newOwnerUserId: NEW_OWNER_ID,
      newOwnerCurrentRole: null,
    });
    expect(result).toEqual({ success: false, reason: "NEW_OWNER_NOT_MEMBER" });
  });

  it("rejects when new owner is already OWNER (defensive guard)", () => {
    const result = transferOwnership({
      currentOwnerUserId: OWNER_ID,
      newOwnerUserId: NEW_OWNER_ID,
      newOwnerCurrentRole: "OWNER",
    });
    expect(result).toEqual({ success: false, reason: "NEW_OWNER_ALREADY_OWNER" });
  });

  it("SELF_TRANSFER takes precedence over NEW_OWNER_ALREADY_OWNER", () => {
    // Same user as current and new owner — SELF_TRANSFER wins.
    const result = transferOwnership({
      currentOwnerUserId: OWNER_ID,
      newOwnerUserId: OWNER_ID,
      newOwnerCurrentRole: "OWNER",
    });
    expect(result).toEqual({ success: false, reason: "SELF_TRANSFER" });
  });
});
