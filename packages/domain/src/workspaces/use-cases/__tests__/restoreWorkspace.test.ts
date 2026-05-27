// packages/domain/src/workspaces/use-cases/__tests__/restoreWorkspace.test.ts

import { describe, it, expect } from "vitest";
import {
  restoreWorkspace,
  DEFAULT_RESTORE_WINDOW_MS,
} from "../restoreWorkspace";
import type { WorkspaceEntity, WorkspaceSlug } from "../../index";

const FIXED_NOW = new Date("2026-05-27T10:00:00.000Z");
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";

function buildWorkspace(overrides: Partial<WorkspaceEntity> = {}): WorkspaceEntity {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Acme Co",
    slug: "acme-co" as WorkspaceSlug,
    tier: "free",
    ownerId: "33333333-3333-3333-3333-333333333333",
    personalForUserId: null,
    revision: 5,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    deletedAt: new Date("2026-04-01T00:00:00.000Z"), // 56 days before FIXED_NOW
    ...overrides,
  };
}

describe("restoreWorkspace — happy path", () => {
  it("succeeds when deleted within the default 30-day window", () => {
    // Deleted 5 days before FIXED_NOW (well within 30-day window)
    const ws = buildWorkspace({ deletedAt: new Date("2026-05-22T10:00:00.000Z") });
    const result = restoreWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.nextWorkspace.deletedAt).toBeNull();
    expect(result.nextWorkspace.updatedAt).toEqual(FIXED_NOW);
  });

  it("bumps the revision by exactly one", () => {
    const ws = buildWorkspace({
      revision: 5,
      deletedAt: new Date("2026-05-22T10:00:00.000Z"),
    });
    const result = restoreWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.nextWorkspace.revision).toBe(6);
  });

  it("preserves all unchanged fields", () => {
    const ws = buildWorkspace({ deletedAt: new Date("2026-05-22T10:00:00.000Z") });
    const result = restoreWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.nextWorkspace.id).toBe(ws.id);
    expect(result.nextWorkspace.name).toBe(ws.name);
    expect(result.nextWorkspace.slug).toBe(ws.slug);
    expect(result.nextWorkspace.ownerId).toBe(ws.ownerId);
    expect(result.nextWorkspace.createdAt).toEqual(ws.createdAt);
  });
});

describe("restoreWorkspace — invariants", () => {
  it("rejects a live (non-deleted) workspace with NOT_DELETED", () => {
    const ws = buildWorkspace({ deletedAt: null });
    const result = restoreWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result).toEqual({ success: false, reason: "NOT_DELETED" });
  });

  it("rejects a workspace deleted more than 30 days ago with RESTORE_WINDOW_EXPIRED", () => {
    // 31 days before FIXED_NOW
    const deletedAt = new Date(FIXED_NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
    const ws = buildWorkspace({ deletedAt });
    const result = restoreWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result).toEqual({ success: false, reason: "RESTORE_WINDOW_EXPIRED" });
  });
});

describe("restoreWorkspace — window boundary", () => {
  it("succeeds at exactly 30 days from deletion (boundary inclusive)", () => {
    const deletedAt = new Date(FIXED_NOW.getTime() - DEFAULT_RESTORE_WINDOW_MS);
    const ws = buildWorkspace({ deletedAt });
    const result = restoreWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result.success).toBe(true);
  });

  it("fails at 30 days + 1ms (boundary exclusive on the high side)", () => {
    const deletedAt = new Date(FIXED_NOW.getTime() - DEFAULT_RESTORE_WINDOW_MS - 1);
    const ws = buildWorkspace({ deletedAt });
    const result = restoreWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result).toEqual({ success: false, reason: "RESTORE_WINDOW_EXPIRED" });
  });

  it("respects a custom windowMs override (1 day)", () => {
    const oneDayMs = 24 * 60 * 60 * 1000;
    // Deleted 2 days ago — outside the 1-day window
    const deletedAt = new Date(FIXED_NOW.getTime() - 2 * oneDayMs);
    const ws = buildWorkspace({ deletedAt });
    const result = restoreWorkspace({
      workspace: ws,
      actorUserId: ACTOR_ID,
      now: FIXED_NOW,
      windowMs: oneDayMs,
    });

    expect(result).toEqual({ success: false, reason: "RESTORE_WINDOW_EXPIRED" });
  });
});

describe("restoreWorkspace — purity", () => {
  it("does not mutate the input workspace", () => {
    const ws = buildWorkspace({ deletedAt: new Date("2026-05-22T10:00:00.000Z") });
    const snapshot = JSON.parse(JSON.stringify(ws));
    restoreWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(JSON.parse(JSON.stringify(ws))).toEqual(snapshot);
  });

  it("DEFAULT_RESTORE_WINDOW_MS is exactly 30 days", () => {
    expect(DEFAULT_RESTORE_WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
