// packages/domain/src/workspaces/use-cases/__tests__/acceptInvitation.test.ts

import { describe, it, expect } from "vitest";
import { acceptInvitation, type AcceptInvitationRow } from "../acceptInvitation";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const WORKSPACE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INVITATION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_EMAIL = "ali@example.com";
const NOW = new Date("2026-03-15T12:00:00Z");

function makeInvitation(overrides: Partial<AcceptInvitationRow> = {}): AcceptInvitationRow {
  return {
    id: INVITATION_ID,
    workspaceId: WORKSPACE_ID,
    invitedEmail: USER_EMAIL,
    role: "MEMBER",
    expiresAt: new Date("2026-03-22T12:00:00Z"), // 7 days from NOW
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("acceptInvitation — happy path", () => {
  it("succeeds with correct email and valid invitation", () => {
    const result = acceptInvitation({
      invitation: makeInvitation(),
      acceptingUserId: USER_ID,
      acceptingUserEmail: USER_EMAIL,
      workspaceDeleted: false,
      now: NOW,
    });
    expect(result).toEqual({
      success: true,
      alreadyAccepted: false,
      workspaceId: WORKSPACE_ID,
      role: "MEMBER",
    });
  });

  it("is case-insensitive for email matching", () => {
    const result = acceptInvitation({
      invitation: makeInvitation({ invitedEmail: "ALI@Example.COM" }),
      acceptingUserId: USER_ID,
      acceptingUserEmail: "ali@example.com",
      workspaceDeleted: false,
      now: NOW,
    });
    expect(result.success).toBe(true);
  });
});

describe("acceptInvitation — idempotent re-click", () => {
  it("returns success with alreadyAccepted=true when same user re-accepts", () => {
    const result = acceptInvitation({
      invitation: makeInvitation({
        acceptedAt: new Date("2026-03-14T10:00:00Z"),
        acceptedByUserId: USER_ID,
      }),
      acceptingUserId: USER_ID,
      acceptingUserEmail: USER_EMAIL,
      workspaceDeleted: false,
      now: NOW,
    });
    expect(result).toEqual({
      success: true,
      alreadyAccepted: true,
      workspaceId: WORKSPACE_ID,
      role: "MEMBER",
    });
  });
});

describe("acceptInvitation — failure cases", () => {
  it("rejects NOT_FOUND when invitation is null", () => {
    const result = acceptInvitation({
      invitation: null,
      acceptingUserId: USER_ID,
      acceptingUserEmail: USER_EMAIL,
      workspaceDeleted: false,
      now: NOW,
    });
    expect(result).toEqual({ success: false, reason: "NOT_FOUND" });
  });

  it("rejects REVOKED when invitation is revoked", () => {
    const result = acceptInvitation({
      invitation: makeInvitation({ revokedAt: new Date("2026-03-14T00:00:00Z") }),
      acceptingUserId: USER_ID,
      acceptingUserEmail: USER_EMAIL,
      workspaceDeleted: false,
      now: NOW,
    });
    expect(result).toEqual({ success: false, reason: "REVOKED" });
  });

  it("rejects EXPIRED when invitation has expired", () => {
    const result = acceptInvitation({
      invitation: makeInvitation({ expiresAt: new Date("2026-03-14T00:00:00Z") }),
      acceptingUserId: USER_ID,
      acceptingUserEmail: USER_EMAIL,
      workspaceDeleted: false,
      now: NOW, // NOW > expiresAt
    });
    expect(result).toEqual({ success: false, reason: "EXPIRED" });
  });

  it("rejects ALREADY_ACCEPTED_BY_OTHER when another user accepted", () => {
    const result = acceptInvitation({
      invitation: makeInvitation({
        acceptedAt: new Date("2026-03-14T10:00:00Z"),
        acceptedByUserId: OTHER_USER_ID,
      }),
      acceptingUserId: USER_ID,
      acceptingUserEmail: USER_EMAIL,
      workspaceDeleted: false,
      now: NOW,
    });
    expect(result).toEqual({ success: false, reason: "ALREADY_ACCEPTED_BY_OTHER" });
  });

  it("rejects WORKSPACE_DELETED when workspace is soft-deleted", () => {
    const result = acceptInvitation({
      invitation: makeInvitation(),
      acceptingUserId: USER_ID,
      acceptingUserEmail: USER_EMAIL,
      workspaceDeleted: true,
      now: NOW,
    });
    expect(result).toEqual({ success: false, reason: "WORKSPACE_DELETED" });
  });

  it("rejects EMAIL_MISMATCH when emails don't match", () => {
    const result = acceptInvitation({
      invitation: makeInvitation({ invitedEmail: "other@example.com" }),
      acceptingUserId: USER_ID,
      acceptingUserEmail: USER_EMAIL,
      workspaceDeleted: false,
      now: NOW,
    });
    expect(result).toEqual({ success: false, reason: "EMAIL_MISMATCH" });
  });
});

describe("acceptInvitation — guard evaluation order", () => {
  it("REVOKED takes precedence over EXPIRED", () => {
    const result = acceptInvitation({
      invitation: makeInvitation({
        revokedAt: new Date("2026-03-10T00:00:00Z"),
        expiresAt: new Date("2026-03-10T00:00:00Z"), // also expired
      }),
      acceptingUserId: USER_ID,
      acceptingUserEmail: USER_EMAIL,
      workspaceDeleted: false,
      now: NOW,
    });
    expect(result).toEqual({ success: false, reason: "REVOKED" });
  });

  it("EXPIRED takes precedence over EMAIL_MISMATCH", () => {
    const result = acceptInvitation({
      invitation: makeInvitation({
        expiresAt: new Date("2026-03-10T00:00:00Z"),
        invitedEmail: "other@example.com",
      }),
      acceptingUserId: USER_ID,
      acceptingUserEmail: USER_EMAIL,
      workspaceDeleted: false,
      now: NOW,
    });
    expect(result).toEqual({ success: false, reason: "EXPIRED" });
  });

  it("WORKSPACE_DELETED takes precedence over EMAIL_MISMATCH", () => {
    const result = acceptInvitation({
      invitation: makeInvitation({ invitedEmail: "other@example.com" }),
      acceptingUserId: USER_ID,
      acceptingUserEmail: USER_EMAIL,
      workspaceDeleted: true,
      now: NOW,
    });
    expect(result).toEqual({ success: false, reason: "WORKSPACE_DELETED" });
  });
});
