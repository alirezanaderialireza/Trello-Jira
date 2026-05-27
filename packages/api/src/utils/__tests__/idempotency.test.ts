// packages/api/src/utils/__tests__/idempotency.test.ts

import { describe, it, expect, vi } from "vitest";
import { withIdempotency } from "../idempotency";

// ── Fakes ───────────────────────────────────────────────────────────────────

type FakeRecord = { mutationId: string; response: unknown; schemaVersion: string };

function makeCtx(initial: FakeRecord[] = []) {
  const store = new Map<string, FakeRecord>(initial.map((r) => [r.mutationId, r]));

  const findByMutationId = vi.fn(async <T,>(_tx: unknown, mutationId: string) => {
    const r = store.get(mutationId);
    if (!r) return null;
    return {
      mutationId: r.mutationId,
      response: r.response as T,
      schemaVersion: r.schemaVersion,
      createdAt: new Date(),
    };
  });

  const save = vi.fn(async <T,>(_tx: unknown, data: { mutationId: string; response: T; schemaVersion: string }) => {
    if (store.has(data.mutationId)) {
      throw new Error("DUPLICATE_KEY");
    }
    store.set(data.mutationId, {
      mutationId: data.mutationId,
      response: data.response,
      schemaVersion: data.schemaVersion,
    });
  });

  const ctx = {
    repos: { idempotency: { findByMutationId, save } },
    infra: { db: { __tag: "fake-tx" } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { ctx, store, findByMutationId, save };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("withIdempotency — no key", () => {
  it("executes the body once and returns its result", async () => {
    const { ctx, findByMutationId, save } = makeCtx();
    const body = vi.fn(async () => ({ id: "abc" }));

    const out = await withIdempotency(ctx, undefined, "v1", body);

    expect(out).toEqual({ id: "abc" });
    expect(body).toHaveBeenCalledTimes(1);
    expect(findByMutationId).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("does not catch body errors", async () => {
    const { ctx } = makeCtx();
    const body = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(withIdempotency(ctx, undefined, "v1", body)).rejects.toThrow("boom");
  });
});

describe("withIdempotency — with key, first call", () => {
  it("looks up by key, executes body, persists the result", async () => {
    const { ctx, findByMutationId, save, store } = makeCtx();
    const body = vi.fn(async () => ({ id: "abc" }));

    const out = await withIdempotency(ctx, "key-1", "v1", body);

    expect(out).toEqual({ id: "abc" });
    expect(findByMutationId).toHaveBeenCalledExactlyOnceWith({ __tag: "fake-tx" }, "key-1");
    expect(body).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(store.get("key-1")?.response).toEqual({ id: "abc" });
    expect(store.get("key-1")?.schemaVersion).toBe("v1");
  });

  it("does not save if the body throws", async () => {
    const { ctx, save } = makeCtx();
    const body = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(withIdempotency(ctx, "key-1", "v1", body)).rejects.toThrow("boom");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("withIdempotency — with key, replay", () => {
  it("returns the cached response without calling body", async () => {
    const { ctx, save } = makeCtx([
      { mutationId: "key-1", response: { id: "abc" }, schemaVersion: "v1" },
    ]);
    const body = vi.fn(async () => ({ id: "DIFFERENT" }));

    const out = await withIdempotency(ctx, "key-1", "v1", body);

    expect(out).toEqual({ id: "abc" });
    expect(body).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("returns cached response even if schemaVersion arg differs (current behaviour)", async () => {
    // Documenting: F3a.1 does NOT enforce schema-version match on replay.
    // A future bump would need an explicit invalidation strategy.
    const { ctx } = makeCtx([
      { mutationId: "key-1", response: { id: "abc" }, schemaVersion: "v1" },
    ]);
    const body = vi.fn(async () => ({ id: "DIFFERENT" }));

    const out = await withIdempotency(ctx, "key-1", "v2", body);

    expect(out).toEqual({ id: "abc" });
    expect(body).not.toHaveBeenCalled();
  });
});
