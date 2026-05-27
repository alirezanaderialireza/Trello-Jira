// packages/domain/src/workspaces/use-cases/__tests__/revokeInvitation.test.ts

import { describe, it, expect } from "vitest";
import { revokeInvitation, type RevokeInvitationRow } from "../revokeInvitation";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INVITATION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeInvitation(overrides: Partial<RevokeInvitationRow> = {}): RevokeInvitationRow {
  return {
    id: INVITATION_ID,
    workspaceId: WORKSPACE_ID,
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("revokeInvitation — happy path", () => {
  it("succeeds for a pending invitation", () => {
    const result = revokeInvitation({ invitation: makeInvitation() });
    expect(result).toEqual({ success: true });
  });
});

describe("revokeInvitation — failure cases", () => {
  it("rejects NOT_FOUND when invitation is null", () => {
    const result = revokeInvitation({ invitation: null });
    expect(result).toEqual({ success: false, reason: "NOT_FOUND" });
  });

  it("rejects ALREADY_ACCEPTED when invitation was already accepted", () => {
    const result = revokeInvitation({
      invitation: makeInvitation({ acceptedAt: new Date("2026-03-14T00:00:00Z") }),
    });
    expect(result).toEqual({ success: false, reason: "ALREADY_ACCEPTED" });
  });

  it("rejects ALREADY_REVOKED when invitation was already revoked", () => {
    const result = revokeInvitation({
      invitation: makeInvitation({ revokedAt: new Date("2026-03-13T00:00:00Z") }),
    });
    expect(result).toEqual({ success: false, reason: "ALREADY_REVOKED" });
  });
});

describe("revokeInvitation — guard evaluation order", () => {
  it("ALREADY_ACCEPTED takes precedence over ALREADY_REVOKED", () => {
    // Edge case: both fields set (shouldn't happen due to DB CHECK,
    // but defensive code handles it).
    const result = revokeInvitation({
      invitation: makeInvitation({
        acceptedAt: new Date("2026-03-14T00:00:00Z"),
        revokedAt: new Date("2026-03-13T00:00:00Z"),
      }),
    });
    expect(result).toEqual({ success: false, reason: "ALREADY_ACCEPTED" });
  });
});
