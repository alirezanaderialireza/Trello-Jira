// packages/api/src/middleware/__tests__/procedures.test.ts
//
// Tests for the F2 procedure-builder helpers. We test the small
// pure/near-pure helpers exposed for this purpose:
//
//   • loadWorkspaceMembership        — DB lookup with mocked ctx
//   • requireWorkspaceManagerRole    — role gate
//   • requireWorkspaceOwnerRole      — role gate
//   • requireBoardManagerRole        — role gate
//   • assertWorkspaceWritable        — workspace lifecycle gate
//   • assertBoardWritable            — board lifecycle gate (+ allowArchived)
//
// We do NOT spin up a real tRPC pipeline here. The full procedure
// builders compose these helpers with `protectedProcedure.use(...)`,
// which means the wiring is verified by typecheck + the e2e router
// tests that F3 will introduce.

import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";

import {
  loadWorkspaceMembership,
  requireWorkspaceManagerRole,
  requireWorkspaceOwnerRole,
} from "../workspaceRoleProcedures";
import { requireBoardManagerRole } from "../boardRoleProcedures";
import {
  assertWorkspaceWritable,
  assertBoardWritable,
} from "../writeProcedures";

// ════════════════════════════════════════════════════════════════════════════
// loadWorkspaceMembership
// ════════════════════════════════════════════════════════════════════════════

describe("loadWorkspaceMembership", () => {
  // Helper: build a ctx with a mocked drizzle relational query.
  function mockCtx(opts: {
    userId?: string;
    membershipRow?: { role: string } | null;
  }) {
    const findFirst = vi.fn().mockResolvedValue(opts.membershipRow ?? null);
    return {
      ctx: {
        session: opts.userId ? { user: { id: opts.userId } } : null,
        infra: {
          db: {
            query: {
              workspaceMembers: { findFirst },
            },
          },
        },
      },
      findFirst,
    };
  }

  it("rejects when input.workspaceId is missing", async () => {
    const { ctx } = mockCtx({ userId: "u1" });
    const getRawInput = async () => ({});

    await expect(
      loadWorkspaceMembership(ctx, getRawInput),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "BAD_REQUEST" }),
    );
  });

  it("rejects when input.workspaceId is not a string", async () => {
    const { ctx } = mockCtx({ userId: "u1" });
    const getRawInput = async () => ({ workspaceId: 123 });

    await expect(
      loadWorkspaceMembership(ctx, getRawInput),
    ).rejects.toThrow(TRPCError);
  });

  it("rejects with UNAUTHORIZED when session.user.id is missing", async () => {
    const { ctx } = mockCtx({ userId: undefined });
    const getRawInput = async () => ({ workspaceId: "ws-1" });

    await expect(
      loadWorkspaceMembership(ctx, getRawInput),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "UNAUTHORIZED" }),
    );
  });

  it("rejects with FORBIDDEN when no membership row found", async () => {
    const { ctx, findFirst } = mockCtx({
      userId: "u1",
      membershipRow: null,
    });
    const getRawInput = async () => ({ workspaceId: "ws-1" });

    await expect(
      loadWorkspaceMembership(ctx, getRawInput),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it("returns membership context when row exists", async () => {
    const { ctx } = mockCtx({
      userId: "u1",
      membershipRow: { role: "ADMIN" },
    });
    const getRawInput = async () => ({ workspaceId: "ws-1" });

    const m = await loadWorkspaceMembership(ctx, getRawInput);
    expect(m).toEqual({
      workspaceId: "ws-1",
      role: "ADMIN",
      userId: "u1",
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// requireWorkspaceManagerRole
// ════════════════════════════════════════════════════════════════════════════

describe("requireWorkspaceManagerRole", () => {
  it("allows OWNER", () => {
    expect(() => requireWorkspaceManagerRole("OWNER")).not.toThrow();
  });
  it("allows ADMIN", () => {
    expect(() => requireWorkspaceManagerRole("ADMIN")).not.toThrow();
  });
  it("blocks MEMBER with FORBIDDEN", () => {
    expect(() => requireWorkspaceManagerRole("MEMBER")).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });
  it("blocks VIEWER with FORBIDDEN", () => {
    expect(() => requireWorkspaceManagerRole("VIEWER")).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// requireWorkspaceOwnerRole
// ════════════════════════════════════════════════════════════════════════════

describe("requireWorkspaceOwnerRole", () => {
  it("allows OWNER", () => {
    expect(() => requireWorkspaceOwnerRole("OWNER")).not.toThrow();
  });
  it("blocks ADMIN", () => {
    expect(() => requireWorkspaceOwnerRole("ADMIN")).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });
  it("blocks MEMBER", () => {
    expect(() => requireWorkspaceOwnerRole("MEMBER")).toThrow(TRPCError);
  });
  it("blocks VIEWER", () => {
    expect(() => requireWorkspaceOwnerRole("VIEWER")).toThrow(TRPCError);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// requireBoardManagerRole
// ════════════════════════════════════════════════════════════════════════════

describe("requireBoardManagerRole", () => {
  it("allows OWNER", () => {
    expect(() => requireBoardManagerRole("OWNER")).not.toThrow();
  });
  it("allows ADMIN", () => {
    expect(() => requireBoardManagerRole("ADMIN")).not.toThrow();
  });
  it("blocks EDITOR (BoardRole superset)", () => {
    expect(() => requireBoardManagerRole("EDITOR")).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });
  it("blocks VIEWER", () => {
    expect(() => requireBoardManagerRole("VIEWER")).toThrow(TRPCError);
  });
  it("blocks NONE", () => {
    expect(() => requireBoardManagerRole("NONE")).toThrow(TRPCError);
  });
  it("blocks undefined", () => {
    expect(() => requireBoardManagerRole(undefined)).toThrow(TRPCError);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// assertWorkspaceWritable
// ════════════════════════════════════════════════════════════════════════════

describe("assertWorkspaceWritable", () => {
  it("passes for an active workspace", () => {
    expect(() =>
      assertWorkspaceWritable({ deletedAt: null }),
    ).not.toThrow();
  });
  it("throws NOT_FOUND when ws is null", () => {
    expect(() => assertWorkspaceWritable(null)).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
  it("throws NOT_FOUND when ws is undefined", () => {
    expect(() => assertWorkspaceWritable(undefined)).toThrow(TRPCError);
  });
  it("throws NOT_FOUND when ws is soft-deleted", () => {
    expect(() =>
      assertWorkspaceWritable({ deletedAt: new Date() }),
    ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// assertBoardWritable
// ════════════════════════════════════════════════════════════════════════════

describe("assertBoardWritable", () => {
  const active = { archivedAt: null, deletedAt: null };
  const archived = { archivedAt: new Date(), deletedAt: null };
  const deleted = { archivedAt: null, deletedAt: new Date() };
  const both = { archivedAt: new Date(), deletedAt: new Date() };

  it("passes for an active board (default opts)", () => {
    expect(() => assertBoardWritable(active)).not.toThrow();
  });
  it("rejects archived board by default with FORBIDDEN", () => {
    expect(() => assertBoardWritable(archived)).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });
  it("ALLOWS archived board when allowArchived=true", () => {
    expect(() =>
      assertBoardWritable(archived, { allowArchived: true }),
    ).not.toThrow();
  });
  it("rejects deleted board with NOT_FOUND even with allowArchived=true", () => {
    expect(() =>
      assertBoardWritable(deleted, { allowArchived: true }),
    ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
  });
  it("rejects archived+deleted with NOT_FOUND (delete dominates)", () => {
    expect(() =>
      assertBoardWritable(both, { allowArchived: true }),
    ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
  });
  it("rejects null board with NOT_FOUND", () => {
    expect(() => assertBoardWritable(null)).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});
