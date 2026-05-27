// packages/domain/src/workspaces/use-cases/__tests__/softDeleteWorkspace.test.ts

import { describe, it, expect } from "vitest";
import { softDeleteWorkspace } from "../softDeleteWorkspace";
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
    revision: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("softDeleteWorkspace — happy path", () => {
  it("succeeds for a live, non-personal workspace", () => {
    const ws = buildWorkspace();
    const result = softDeleteWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.nextWorkspace.deletedAt).toEqual(FIXED_NOW);
    expect(result.nextWorkspace.updatedAt).toEqual(FIXED_NOW);
  });

  it("bumps the revision by exactly one", () => {
    const ws = buildWorkspace({ revision: 7 });
    const result = softDeleteWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.nextWorkspace.revision).toBe(8);
  });

  it("preserves all unchanged fields (id, name, slug, tier, ownerId, createdAt)", () => {
    const ws = buildWorkspace();
    const result = softDeleteWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.nextWorkspace.id).toBe(ws.id);
    expect(result.nextWorkspace.name).toBe(ws.name);
    expect(result.nextWorkspace.slug).toBe(ws.slug);
    expect(result.nextWorkspace.tier).toBe(ws.tier);
    expect(result.nextWorkspace.ownerId).toBe(ws.ownerId);
    expect(result.nextWorkspace.createdAt).toEqual(ws.createdAt);
  });
});

describe("softDeleteWorkspace — invariants", () => {
  it("rejects an already-soft-deleted workspace with ALREADY_DELETED", () => {
    const ws = buildWorkspace({ deletedAt: new Date("2026-04-01T00:00:00.000Z") });
    const result = softDeleteWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result).toEqual({ success: false, reason: "ALREADY_DELETED" });
  });

  it("rejects a personal workspace with PERSONAL_WORKSPACE", () => {
    const ws = buildWorkspace({ personalForUserId: ACTOR_ID });
    const result = softDeleteWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result).toEqual({ success: false, reason: "PERSONAL_WORKSPACE" });
  });

  it("ALREADY_DELETED takes precedence over PERSONAL_WORKSPACE when both apply", () => {
    // A personal workspace that was somehow soft-deleted (shouldn't happen,
    // but the use case should still pick a deterministic reason).
    const ws = buildWorkspace({
      personalForUserId: ACTOR_ID,
      deletedAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    const result = softDeleteWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result).toEqual({ success: false, reason: "ALREADY_DELETED" });
  });
});

describe("softDeleteWorkspace — purity", () => {
  it("does not mutate the input workspace", () => {
    const ws = buildWorkspace();
    const snapshot = JSON.parse(JSON.stringify(ws));
    softDeleteWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(JSON.parse(JSON.stringify(ws))).toEqual(snapshot);
  });

  it("does not return the same object reference as the input", () => {
    const ws = buildWorkspace();
    const result = softDeleteWorkspace({ workspace: ws, actorUserId: ACTOR_ID, now: FIXED_NOW });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.nextWorkspace).not.toBe(ws);
  });
});
