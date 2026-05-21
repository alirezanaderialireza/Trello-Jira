// apps/web/src/features/board/realtime/__tests__/sync-state.test.ts
//
// Phase-1.2 — SyncState FSM tests (updated for v1.1 protocol)

import { describe, it, expect } from "vitest";
import {
  transition,
  isLive,
  isDegraded,
  isTerminal,
  isInactive,
  INITIAL_SYNC_CONTEXT,
  type SyncState,
  type SyncEvent,
} from "../sync-state";

function transit(from: SyncState, event: SyncEvent): SyncState {
  return transition(from, event).nextState;
}
function changed(from: SyncState, event: SyncEvent): boolean {
  return transition(from, event).changed;
}

// ── Happy path ────────────────────────────────────────────────────────────────
describe("happy path — offline → connecting → connected", () => {
  it("offline + CONNECT_REQUESTED → connecting", () => {
    expect(transit("offline", { type: "CONNECT_REQUESTED", boardId: "b1" })).toBe("connecting");
    expect(changed("offline", { type: "CONNECT_REQUESTED", boardId: "b1" })).toBe(true);
  });
  it("connecting + WS_OPEN → connecting (waiting for SUBSCRIBED)", () => {
    expect(transit("connecting", { type: "WS_OPEN" })).toBe("connecting");
    expect(changed("connecting", { type: "WS_OPEN" })).toBe(false);
  });
  it("connecting + SERVER_SUBSCRIBED → connected", () => {
    expect(transit("connecting", { type: "SERVER_SUBSCRIBED" })).toBe("connected");
  });
  it("connected + HEARTBEAT_OK → connected (no-op)", () => {
    expect(transit("connected", { type: "HEARTBEAT_OK" })).toBe("connected");
    expect(changed("connected", { type: "HEARTBEAT_OK" })).toBe(false);
  });
});

// ── Gap / catch-up path ───────────────────────────────────────────────────────
describe("gap detection path", () => {
  it("connected + GAP_DETECTED → catching-up", () => {
    expect(transit("connected", { type: "GAP_DETECTED", missing: "103", expected: "102" })).toBe("catching-up");
  });
  it("catching-up + GAP_RESOLVED → connected", () => {
    expect(transit("catching-up", { type: "GAP_RESOLVED" })).toBe("connected");
  });
  it("catching-up + GAP_IRRECOVERABLE → resyncing", () => {
    expect(transit("catching-up", { type: "GAP_IRRECOVERABLE", currentSeq: "42", serverSeq: "9000" })).toBe("resyncing");
  });
});

// ── Resync path ───────────────────────────────────────────────────────────────
describe("resync path", () => {
  it("connected + SERVER_RESYNC_REQUIRED → resyncing", () => {
    expect(transit("connected", { type: "SERVER_RESYNC_REQUIRED", reason: "log_overflow" })).toBe("resyncing");
  });
  it("resyncing + SNAPSHOT_STARTED → resyncing (idempotent)", () => {
    expect(transit("resyncing", { type: "SNAPSHOT_STARTED" })).toBe("resyncing");
    expect(changed("resyncing", { type: "SNAPSHOT_STARTED" })).toBe(false);
  });
  it("resyncing + SNAPSHOT_APPLIED → connected", () => {
    expect(transit("resyncing", { type: "SNAPSHOT_APPLIED", newSequence: "1042" })).toBe("connected");
  });
  it("resyncing + SNAPSHOT_FAILED → desynced", () => {
    expect(transit("resyncing", { type: "SNAPSHOT_FAILED", reason: "network_error" })).toBe("desynced");
  });
});

// ── Reconnect path ────────────────────────────────────────────────────────────
describe("reconnect path", () => {
  it("connected + HEARTBEAT_STALE → connecting", () => {
    expect(transit("connected", { type: "HEARTBEAT_STALE", missedMs: 5000 })).toBe("connecting");
  });
  it("connected + WS_CLOSED → connecting", () => {
    expect(transit("connected", { type: "WS_CLOSED", code: 1006, reason: "" })).toBe("connecting");
  });
  it("connecting + RECONNECT_EXHAUSTED → desynced", () => {
    expect(transit("connecting", { type: "RECONNECT_EXHAUSTED" })).toBe("desynced");
  });
  it("desynced + CONNECT_REQUESTED → connecting (manual retry)", () => {
    expect(transit("desynced", { type: "CONNECT_REQUESTED", boardId: "b1" })).toBe("connecting");
  });
});

// ── Disconnect path ───────────────────────────────────────────────────────────
describe("disconnect path", () => {
  const disconnectEvt: SyncEvent = { type: "DISCONNECT_REQUESTED" };
  it("connected → offline",    () => expect(transit("connected",   disconnectEvt)).toBe("offline"));
  it("connecting → offline",   () => expect(transit("connecting",  disconnectEvt)).toBe("offline"));
  it("catching-up → offline",  () => expect(transit("catching-up", disconnectEvt)).toBe("offline"));
  it("resyncing → offline",    () => expect(transit("resyncing",   disconnectEvt)).toBe("offline"));
  it("desynced → offline",     () => expect(transit("desynced",    disconnectEvt)).toBe("offline"));
});

// ── WS_CLOSED from degraded states ───────────────────────────────────────────
describe("WS_CLOSED from degraded states", () => {
  const closedEvt: SyncEvent = { type: "WS_CLOSED", code: 1006, reason: "" };
  it("catching-up + WS_CLOSED → connecting", () => expect(transit("catching-up", closedEvt)).toBe("connecting"));
  it("resyncing + WS_CLOSED → connecting",   () => expect(transit("resyncing",   closedEvt)).toBe("connecting"));
});

// ── Illegal transitions ───────────────────────────────────────────────────────
describe("illegal transitions — throw in dev (vitest = dev-like)", () => {
  it("offline + WS_OPEN is illegal → throws", () => {
    expect(() => transition("offline", { type: "WS_OPEN" }))
      .toThrow("Illegal transition: offline:WS_OPEN");
  });
  it("connected + SNAPSHOT_APPLIED is illegal → throws", () => {
    expect(() => transition("connected", { type: "SNAPSHOT_APPLIED", newSequence: "99" }))
      .toThrow("Illegal transition: connected:SNAPSHOT_APPLIED");
  });
  it("offline + GAP_DETECTED is illegal → throws", () => {
    expect(() => transition("offline", { type: "GAP_DETECTED", missing: "5", expected: "4" }))
      .toThrow("Illegal transition: offline:GAP_DETECTED");
  });
});

// ── Guard predicates ──────────────────────────────────────────────────────────
describe("guard predicates", () => {
  it("isLive: only connected", () => {
    expect(isLive("connected")).toBe(true);
    expect(isLive("catching-up")).toBe(false);
  });
  it("isDegraded: connecting | catching-up | resyncing", () => {
    expect(isDegraded("connecting")).toBe(true);
    expect(isDegraded("catching-up")).toBe(true);
    expect(isDegraded("resyncing")).toBe(true);
    expect(isDegraded("connected")).toBe(false);
  });
  it("isTerminal: only desynced", () => {
    expect(isTerminal("desynced")).toBe(true);
    expect(isTerminal("offline")).toBe(false);
  });
  it("isInactive: offline | desynced", () => {
    expect(isInactive("offline")).toBe(true);
    expect(isInactive("desynced")).toBe(true);
    expect(isInactive("connected")).toBe(false);
  });
  it("predicates are mutually exclusive", () => {
    const states: SyncState[] = ["offline","connecting","connected","catching-up","resyncing","desynced"];
    for (const s of states) {
      const flags = [isLive(s), isDegraded(s), isTerminal(s)].filter(Boolean);
      expect(flags.length).toBeLessThanOrEqual(1);
    }
  });
});

// ── INITIAL_SYNC_CONTEXT ──────────────────────────────────────────────────────
describe("INITIAL_SYNC_CONTEXT", () => {
  it("starts offline with zeroed fields", () => {
    expect(INITIAL_SYNC_CONTEXT.state).toBe("offline");
    expect(INITIAL_SYNC_CONTEXT.boardId).toBeNull();
    expect(INITIAL_SYNC_CONTEXT.lastSequence).toBe("0");
    expect(INITIAL_SYNC_CONTEXT.reconnectCount).toBe(0);
  });
});
