// packages/domain/src/workspaces/__tests__/workspaces.test.ts
import { describe, it, expect } from "vitest";
import {
  validateSlug,
  generateSlugFromName,
  createPersonalWorkspace,
  isValidRole,
  canManageMembers,
  canDeleteWorkspace,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from "../index";

describe("Workspace Domain — Slug", () => {
  it("validates correct slug", () => { expect(validateSlug("my-workspace-1")).toBe(true); });
  it("rejects too short (<2)", () => { expect(validateSlug("a")).toBe(false); });
  it("rejects too long (>60)", () => { expect(validateSlug("a".repeat(61))).toBe(false); });
  it("rejects uppercase", () => { expect(validateSlug("MyWorkspace")).toBe(false); });
  it("rejects special chars", () => { expect(validateSlug("my_workspace")).toBe(false); });
  it("rejects starting with dash", () => { expect(validateSlug("-workspace")).toBe(false); });
  it("rejects ending with dash", () => { expect(validateSlug("workspace-")).toBe(false); });

  it("generates slug from English name", () => {
    const slug = generateSlugFromName("My Cool Project");
    expect(slug).toBe("my-cool-project");
    expect(validateSlug(slug)).toBe(true);
  });

  it("generates random slug from Persian name", () => {
    const slug = generateSlugFromName("پروژه من");
    expect(slug.startsWith("ws-")).toBe(true);
    expect(validateSlug(slug)).toBe(true);
  });

  it("handles mixed ASCII + Unicode", () => {
    const slug = generateSlugFromName("Project علیرضا 123");
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(validateSlug(slug)).toBe(true);
  });
});

describe("Workspace Domain — Roles", () => {
  it("validates OWNER", () => { expect(isValidRole("OWNER")).toBe(true); });
  it("validates MEMBER", () => { expect(isValidRole("MEMBER")).toBe(true); });
  it("rejects invalid", () => { expect(isValidRole("SUPERADMIN")).toBe(false); });

  // ── Regression guards: keep DB CHECK constraint in 0003 in lockstep ──
  it("WORKSPACE_ROLES contains exactly 4 values", () => {
    expect(WORKSPACE_ROLES).toHaveLength(4);
  });

  it("WORKSPACE_ROLES holds OWNER, ADMIN, MEMBER, VIEWER (in order)", () => {
    expect([...WORKSPACE_ROLES]).toEqual(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
  });

  it("isValidRole rejects empty string and case-mismatch", () => {
    expect(isValidRole("")).toBe(false);
    expect(isValidRole("owner")).toBe(false);
    expect(isValidRole("Member")).toBe(false);
  });

  // ── Permission helpers ──────────────────────────────────────────────
  it("canManageMembers: OWNER and ADMIN only", () => {
    const truthy: WorkspaceRole[] = ["OWNER", "ADMIN"];
    const falsy: WorkspaceRole[] = ["MEMBER", "VIEWER"];
    truthy.forEach((r) => expect(canManageMembers(r)).toBe(true));
    falsy.forEach((r) => expect(canManageMembers(r)).toBe(false));
  });

  it("canDeleteWorkspace: OWNER only", () => {
    expect(canDeleteWorkspace("OWNER")).toBe(true);
    (["ADMIN", "MEMBER", "VIEWER"] as WorkspaceRole[]).forEach((r) =>
      expect(canDeleteWorkspace(r)).toBe(false),
    );
  });
});

describe("Workspace Domain — createPersonalWorkspace", () => {
  it("creates workspace with correct structure", () => {
    const { workspace, member } = createPersonalWorkspace("user-123", "علیرضا");
    expect(workspace.name).toBe("علیرضا's Workspace");
    expect(workspace.ownerId).toBe("user-123");
    expect(workspace.personalForUserId).toBe("user-123");
    expect(workspace.tier).toBe("free");
    expect(member.role).toBe("OWNER");
    expect(member.userId).toBe("user-123");
  });

  it("generates valid slug even for Persian name", () => {
    const { workspace } = createPersonalWorkspace("u1", "محمد");
    expect(validateSlug(workspace.slug)).toBe(true);
  });
});
