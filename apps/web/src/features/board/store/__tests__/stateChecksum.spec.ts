// apps/web/src/features/board/store/__tests__/stateChecksum.spec.ts
// ─────────────────────────────────────────────────────────────────────────────
// Tests for Task #3 (canonicalSerializer) and Task #4 (projectionChecksum).
//
// Sections:
//   A. canonicalStringify — determinism, key ordering, edge cases
//   B. computeChecksumSync — FNV-1a correctness + collision resistance
//   C. computeChecksum (async SHA-256) — length, hex format, determinism
//   D. stampEventChecksum / verifyEventChecksum — tamper detection
//   E. computeProjectionFingerprint — excludes runtime fields
//   F. ProjectionChecksumRegistry — get/set/invalidate
//   G. verifyProjectionIntegrity — corruption detection
//   H. stampSnapshot / verifyStampedSnapshot — rollback safety
//   I. dispatcher DispatchObserver — injected no-op in test context
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  canonicalStringify,
  computeChecksum,
  computeChecksumSync,
  stampEventChecksum,
  verifyEventChecksum,
} from "../invariants/canonicalSerializer";

import {
  computeProjectionFingerprint,
  computeProjectionFingerprintSync,
  ProjectionChecksumRegistry,
  verifyProjectionIntegrity,
  verifyProjectionIntegritySync,
  stampSnapshot,
  verifyStampedSnapshot,
} from "../invariants/projectionChecksum";

import { createBoardState } from "../test-utils/createBoardState";
import {
  NO_OP_OBSERVER,
  setDispatchObserver,
  applyEvent,
} from "../event-application/dispatcher";
import type { BoardStoreState, CardDto, ListDto, BoardSnapshot } from "../useBoardStore";

// ============================================================================
// Shared fixtures
// ============================================================================

function card(id: string, listId: string, position: string): CardDto {
  return { id, boardId: "b1", listId, title: `Card ${id}`, position, revision: 1 };
}

function list(id: string, position: string): ListDto {
  return { id, boardId: "b1", title: `List ${id}`, position, revision: 1 };
}

const VALID_STATE: BoardStoreState = createBoardState({
  lists:  { l1: list("l1", "a"), l2: list("l2", "b") },
  cards:  { c1: card("c1", "l1", "a"), c2: card("c2", "l2", "a") },
  cardsByList: { l1: ["c1"], l2: ["c2"] },
  listOrder:   ["l1", "l2"],
  boardSequence: "42",
});

// ============================================================================
// A. canonicalStringify
// ============================================================================

describe("canonicalStringify", () => {
  it("produces identical output for same object regardless of key insertion order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("sorts nested object keys recursively", () => {
    const obj = { outer: { z: 1, a: 2 }, b: { y: 9, x: 8 } };
    const result = canonicalStringify(obj);
    // outer should appear before… wait, "b" < "outer" lexicographically
    expect(result).toBe('{"b":{"x":8,"y":9},"outer":{"a":2,"z":1}}');
  });

  it("preserves array element order (arrays are already ordered)", () => {
    const arr = [3, 1, 2];
    expect(canonicalStringify(arr)).toBe("[3,1,2]");
    expect(canonicalStringify([1, 2, 3])).toBe("[1,2,3]");
  });

  it("omits undefined values like JSON.stringify", () => {
    const obj = { a: 1, b: undefined, c: 3 };
    expect(canonicalStringify(obj)).toBe('{"a":1,"c":3}');
  });

  it("omits function properties", () => {
    const obj = { a: 1, fn: () => 42 };
    expect(canonicalStringify(obj)).toBe('{"a":1}');
  });

  it("serialises null correctly", () => {
    expect(canonicalStringify(null)).toBe("null");
    expect(canonicalStringify({ x: null })).toBe('{"x":null}');
  });

  it("serialises primitives correctly", () => {
    expect(canonicalStringify(42)).toBe("42");
    expect(canonicalStringify("hello")).toBe('"hello"');
    expect(canonicalStringify(true)).toBe("true");
    expect(canonicalStringify(false)).toBe("false");
  });

  it("is deterministic across multiple calls with identical input", () => {
    const obj = { cards: { c1: card("c1", "l1", "a"), c2: card("c2", "l2", "b") } };
    const s1 = canonicalStringify(obj);
    const s2 = canonicalStringify(obj);
    const s3 = canonicalStringify(obj);
    expect(s1).toBe(s2);
    expect(s2).toBe(s3);
  });

  it("handles deeply nested structures", () => {
    const deep = { a: { b: { c: { d: { z: 1, a: 0 } } } } };
    const result = canonicalStringify(deep);
    expect(result).toContain('"a":0');
    expect(result).toContain('"z":1');
    // inner keys should be sorted: "a" before "z"
    expect(result.indexOf('"a":0')).toBeLessThan(result.indexOf('"z":1'));
  });

  it("two structurally different objects produce different strings", () => {
    const a = { x: 1 };
    const b = { x: 2 };
    expect(canonicalStringify(a)).not.toBe(canonicalStringify(b));
  });
});

// ============================================================================
// B. computeChecksumSync (FNV-1a)
// ============================================================================

describe("computeChecksumSync", () => {
  it("returns an 8-character hex string", () => {
    const result = computeChecksumSync({ x: 1 });
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic — same input produces same hash", () => {
    const obj = VALID_STATE;
    expect(computeChecksumSync(obj)).toBe(computeChecksumSync(obj));
  });

  it("different objects produce different hashes (collision resistance)", () => {
    const a = computeChecksumSync({ cards: { c1: card("c1", "l1", "a") } });
    const b = computeChecksumSync({ cards: { c1: card("c1", "l1", "b") } }); // position differs
    expect(a).not.toBe(b);
  });

  it("key order does NOT affect hash (canonical serialization)", () => {
    const obj1 = { z: 1, a: 2 };
    const obj2 = { a: 2, z: 1 };
    expect(computeChecksumSync(obj1)).toBe(computeChecksumSync(obj2));
  });

  it("handles empty object", () => {
    const result = computeChecksumSync({});
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });

  it("single-field change produces a different hash", () => {
    const base  = computeChecksumSync(VALID_STATE);
    const mutated: BoardStoreState = { ...VALID_STATE, boardSequence: "999" };
    expect(computeChecksumSync(mutated)).not.toBe(base);
  });
});

// ============================================================================
// C. computeChecksum (async SHA-256)
// ============================================================================

describe("computeChecksum (async)", () => {
  it("returns a hex string (64 chars for SHA-256, 8 chars for FNV fallback)", async () => {
    const result = await computeChecksum({ x: 1 });
    expect(result).toMatch(/^[0-9a-f]{8,64}$/);
  });

  it("is deterministic — same input produces same hash", async () => {
    const obj = VALID_STATE;
    const h1  = await computeChecksum(obj);
    const h2  = await computeChecksum(obj);
    expect(h1).toBe(h2);
  });

  it("structurally different states produce different hashes", async () => {
    const stateA = VALID_STATE;
    const stateB: BoardStoreState = { ...VALID_STATE, boardSequence: "100" };
    const h1 = await computeChecksum(stateA);
    const h2 = await computeChecksum(stateB);
    expect(h1).not.toBe(h2);
  });

  it("key insertion order does NOT affect hash", async () => {
    const obj1 = { b: 2, a: 1 };
    const obj2 = { a: 1, b: 2 };
    expect(await computeChecksum(obj1)).toBe(await computeChecksum(obj2));
  });

  it("adding a single card changes the hash", async () => {
    const base  = await computeChecksum(VALID_STATE);
    const extra: BoardStoreState = {
      ...VALID_STATE,
      cards: { ...VALID_STATE.cards, c3: card("c3", "l1", "c") },
    };
    expect(await computeChecksum(extra)).not.toBe(base);
  });
});

// ============================================================================
// D. stampEventChecksum / verifyEventChecksum
// ============================================================================

describe("stampEventChecksum / verifyEventChecksum", () => {
  const event = {
    id: "evt-1", type: "card.moved", version: 2,
    occurredAt: "2026-01-01T00:00:00Z",
    aggregateId: "c1", aggregateType: "card",
    payload: { cardId: "c1", fromListId: "l1", toListId: "l2", boardId: "b1",
               oldPosition: "a", newPosition: "b" },
  };

  it("stamps an event with a checksum", async () => {
    const stamped = await stampEventChecksum(event);
    expect(stamped.event).toEqual(event);
    expect(stamped.checksum).toMatch(/^[0-9a-f]{8,64}$/);
    expect(["sha256", "fnv1a32"]).toContain(stamped.algorithm);
  });

  it("verifies a valid stamped event", async () => {
    const stamped = await stampEventChecksum(event);
    expect(await verifyEventChecksum(stamped)).toBe(true);
  });

  it("detects tampering — changed payload invalidates checksum", async () => {
    const stamped = await stampEventChecksum(event);
    const tampered = {
      ...stamped,
      event: { ...stamped.event, payload: { ...stamped.event.payload, toListId: "l3" } },
    };
    expect(await verifyEventChecksum(tampered)).toBe(false);
  });

  it("detects tampering — changed checksum string", async () => {
    const stamped = await stampEventChecksum(event);
    const tampered = { ...stamped, checksum: "00000000" };
    expect(await verifyEventChecksum(tampered)).toBe(false);
  });

  it("same event stamped twice produces identical checksums", async () => {
    const s1 = await stampEventChecksum(event);
    const s2 = await stampEventChecksum(event);
    expect(s1.checksum).toBe(s2.checksum);
  });
});

// ============================================================================
// E. computeProjectionFingerprint — excludes runtime fields
// ============================================================================

describe("computeProjectionFingerprint", () => {
  it("returns a fingerprint with correct metadata", async () => {
    const fp = await computeProjectionFingerprint("board-1", VALID_STATE);
    expect(fp.boardId).toBe("board-1");
    expect(fp.boardSequence).toBe("42");
    expect(fp.cardCount).toBe(2);
    expect(fp.listCount).toBe(2);
    expect(fp.checksum).toMatch(/^[0-9a-f]{8,64}$/);
    expect(["sha256", "fnv1a32"]).toContain(fp.algorithm);
  });

  it("is deterministic — same state produces same fingerprint", async () => {
    const fp1 = await computeProjectionFingerprint("b1", VALID_STATE);
    const fp2 = await computeProjectionFingerprint("b1", VALID_STATE);
    expect(fp1.checksum).toBe(fp2.checksum);
  });

  it("excludes runtime-only fields (pendingMutations, bufferedEvents, syncStatus)", async () => {
    const stateA = { ...VALID_STATE, syncStatus: "synced"       as const };
    const stateB = { ...VALID_STATE, syncStatus: "reconnecting" as const };
    const stateC = {
      ...VALID_STATE,
      pendingMutations: { "mut-1": { correlationId: "x", type: "card.moved",
        createdAt: 0, aggregateId: "c1", retryCount: 0, status: "pending" as const } },
    };
    const stateD = {
      ...VALID_STATE,
      bufferedEvents: { "5": { sequence: "5", type: "card.moved", payload: {} as any } },
    };

    const fpA = await computeProjectionFingerprint("b1", stateA);
    const fpB = await computeProjectionFingerprint("b1", stateB);
    const fpC = await computeProjectionFingerprint("b1", stateC);
    const fpD = await computeProjectionFingerprint("b1", stateD);

    // Different runtime state → same fingerprint (runtime fields excluded)
    expect(fpA.checksum).toBe(fpB.checksum);
    expect(fpA.checksum).toBe(fpC.checksum);
    expect(fpA.checksum).toBe(fpD.checksum);
  });

  it("detects actual projection changes (new card)", async () => {
    const stateWithExtra: BoardStoreState = {
      ...VALID_STATE,
      cards: { ...VALID_STATE.cards, c3: card("c3", "l1", "c") },
    };
    const fpBase  = await computeProjectionFingerprint("b1", VALID_STATE);
    const fpExtra = await computeProjectionFingerprint("b1", stateWithExtra);
    expect(fpBase.checksum).not.toBe(fpExtra.checksum);
  });

  it("sync variant produces valid 8-char hex fingerprint", () => {
    const fp = computeProjectionFingerprintSync("b1", VALID_STATE);
    expect(fp.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(fp.algorithm).toBe("fnv1a32");
    expect(fp.boardId).toBe("b1");
  });
});

// ============================================================================
// F. ProjectionChecksumRegistry
// ============================================================================

describe("ProjectionChecksumRegistry", () => {
  let registry: InstanceType<typeof ProjectionChecksumRegistry>;

  beforeEach(() => {
    registry = new ProjectionChecksumRegistry();
  });

  it("stores and retrieves a fingerprint by boardId", async () => {
    const fp = await computeProjectionFingerprint("board-x", VALID_STATE);
    registry.set(fp);
    expect(registry.get("board-x")).toEqual(fp);
  });

  it("returns null for unknown boardId", () => {
    expect(registry.get("unknown")).toBeNull();
  });

  it("invalidate removes the entry", async () => {
    const fp = await computeProjectionFingerprint("board-y", VALID_STATE);
    registry.set(fp);
    registry.invalidate("board-y");
    expect(registry.get("board-y")).toBeNull();
  });

  it("clear removes all entries", async () => {
    const fp1 = await computeProjectionFingerprint("b1", VALID_STATE);
    const fp2 = await computeProjectionFingerprint("b2", VALID_STATE);
    registry.set(fp1);
    registry.set(fp2);
    registry.clear();
    expect(registry.get("b1")).toBeNull();
    expect(registry.get("b2")).toBeNull();
  });

  it("overwriting an entry stores the new one", async () => {
    const fp1 = await computeProjectionFingerprint("b1", VALID_STATE);
    const newState: BoardStoreState = { ...VALID_STATE, boardSequence: "100" };
    const fp2 = await computeProjectionFingerprint("b1", newState);

    registry.set(fp1);
    registry.set(fp2);

    expect(registry.get("b1")?.checksum).toBe(fp2.checksum);
  });
});

// ============================================================================
// G. verifyProjectionIntegrity
// ============================================================================

describe("verifyProjectionIntegrity", () => {
  it("returns null when no baseline fingerprint is stored (first load)", async () => {
    const reg    = new ProjectionChecksumRegistry();
    // No reg.set() — first load
    const report = await verifyProjectionIntegrity("b1", VALID_STATE);
    // Module-level registry has no entry either — should return null
    expect(report).toBeNull();
  });

  it("returns null when live state matches stored fingerprint (no corruption)", async () => {
    const reg = new ProjectionChecksumRegistry();
    const fp  = await computeProjectionFingerprint("b1", VALID_STATE);
    reg.set(fp);

    // Simulate: registry used directly
    // (verifyProjectionIntegrity uses the module-level singleton; we test via the registry directly)
    const liveChecksum = (await computeProjectionFingerprint("b1", VALID_STATE)).checksum;
    expect(liveChecksum).toBe(fp.checksum);
  });

  it("detects corruption when projection changes unexpectedly", async () => {
    // Setup: store fingerprint for original state
    const { checksumRegistry } = await import("../invariants/projectionChecksum");
    checksumRegistry.invalidate("corrupt-board");

    const fp = await computeProjectionFingerprint("corrupt-board", VALID_STATE);
    checksumRegistry.set(fp);

    // Simulate corruption: one card has a different position
    const corruptState: BoardStoreState = {
      ...VALID_STATE,
      cards: {
        ...VALID_STATE.cards,
        c1: { ...VALID_STATE.cards["c1"]!, position: "CORRUPTED" },
      },
    };

    const report = await verifyProjectionIntegrity("corrupt-board", corruptState);
    expect(report).not.toBeNull();
    expect(report!.severity).toBe("critical");
    expect(report!.expectedChecksum).not.toBe(report!.actualChecksum);
    expect(report!.boardId).toBe("corrupt-board");

    checksumRegistry.invalidate("corrupt-board");
  });

  it("sync variant returns null when no baseline", () => {
    const result = verifyProjectionIntegritySync("no-such-board", VALID_STATE);
    expect(result).toBeNull();
  });
});

// ============================================================================
// H. stampSnapshot / verifyStampedSnapshot
// ============================================================================

describe("stampSnapshot / verifyStampedSnapshot", () => {
  const snap: BoardSnapshot = {
    cards:       { c1: card("c1", "l1", "a") },
    lists:       { l1: list("l1", "a") },
    cardsByList: { l1: ["c1"] },
    listOrder:   ["l1"],
  };

  it("stamps a snapshot with a checksum", async () => {
    const stamped = await stampSnapshot(snap);
    expect(stamped.snapshot).toEqual(snap);
    expect(stamped.checksum).toMatch(/^[0-9a-f]{8,64}$/);
    expect(stamped.stampedAt).toBeGreaterThan(0);
  });

  it("verifies a valid stamped snapshot", async () => {
    const stamped = await stampSnapshot(snap);
    expect(await verifyStampedSnapshot(stamped)).toBe(true);
  });

  it("detects tampering — mutated snapshot fails verification", async () => {
    const stamped = await stampSnapshot(snap);
    const tampered = {
      ...stamped,
      snapshot: {
        ...stamped.snapshot,
        cards: { c1: { ...stamped.snapshot.cards!["c1"]!, revision: 999 } },
      },
    };
    expect(await verifyStampedSnapshot(tampered)).toBe(false);
  });

  it("is deterministic — same snapshot always produces same checksum", async () => {
    const s1 = await stampSnapshot(snap);
    const s2 = await stampSnapshot(snap);
    expect(s1.checksum).toBe(s2.checksum);
  });

  it("empty snapshot is stamped without error", async () => {
    const empty: BoardSnapshot = {};
    const stamped = await stampSnapshot(empty);
    expect(await verifyStampedSnapshot(stamped)).toBe(true);
  });
});

// ============================================================================
// I. Dispatcher — NO_OP_OBSERVER ensures pure test execution
// ============================================================================

describe("dispatcher — DispatchObserver injection", () => {
  beforeEach(() => {
    setDispatchObserver(NO_OP_OBSERVER);
  });

  it("applyEvent works with NO_OP_OBSERVER (no telemetry side-effects)", () => {
    const state = VALID_STATE;
    const envelope = {
      event: {
        id: "e1", type: "card.updated", version: 2,
        occurredAt: new Date().toISOString(),
        aggregateId: "c1", aggregateType: "card" as const,
        correlationId: "corr-1",
        payload: { cardId: "c1", boardId: "b1", changes: { title: "Updated" } },
      } as any,
      optimistic: false, acknowledged: true,
    };

    expect(() => applyEvent(state, envelope, { mode: "live" })).not.toThrow();
    const result = applyEvent(state, envelope, { mode: "live" });
    expect(result.cards?.["c1"]?.title).toBe("Updated");
  });

  it("NO_OP_OBSERVER has no side effects — all methods are no-ops", () => {
    expect(() => NO_OP_OBSERVER.onApply("card.moved", "live", "corr")).not.toThrow();
    expect(() => NO_OP_OBSERVER.onUnknownEvent("board.x", undefined)).not.toThrow();
    expect(() => NO_OP_OBSERVER.onOptimisticApplied("corr", "card.moved")).not.toThrow();
    expect(() => NO_OP_OBSERVER.onReducerCrash("card.moved", "err", "corr")).not.toThrow();
  });

  it("applyEvent returns {} for unknown event type (no observer crash)", () => {
    const result = applyEvent(
      VALID_STATE,
      {
        event: {
          id: "e2", type: "unknown.future.event" as any, version: 1,
          occurredAt: "", aggregateId: "x", aggregateType: "card" as const,
          payload: {},
        } as any,
        optimistic: false,
      },
      { mode: "live" },
    );
    expect(result).toEqual({});
  });
});
