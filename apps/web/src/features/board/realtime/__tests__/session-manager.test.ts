// apps/web/src/features/board/realtime/__tests__/session-manager.test.ts
//
// Phase-1.2 — SessionManager tests (unchanged logic, updated mock)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionManager } from "../session-manager";

// ── Mock sessionStorage ───────────────────────────────────────────────────────
const sessionStorageData = new Map<string, string>();
const sessionStorageMock = {
  getItem:    (k: string) => sessionStorageData.get(k) ?? null,
  setItem:    (k: string, v: string) => { sessionStorageData.set(k, v); },
  removeItem: (k: string) => { sessionStorageData.delete(k); },
  clear:      () => { sessionStorageData.clear(); },
};
vi.stubGlobal("sessionStorage", sessionStorageMock);

beforeEach(() => { sessionStorageData.clear(); });

// ── Tests ────────────────────────────────────────────────────────────────────
describe("SessionManager — start (fresh session)", () => {
  it("creates a new session with epoch=1 and lastAckedSequence='0'", () => {
    const sm = new SessionManager();
    const s  = sm.start("board-1");
    expect(s.boardId).toBe("board-1");
    expect(s.connectionEpoch).toBe(1);
    expect(s.lastAckedSequence).toBe("0");
    expect(s.sessionId).toBeTruthy();
  });
  it("second start() on same board resumes the same sessionId", () => {
    const sm1 = new SessionManager();
    const s1  = sm1.start("board-1");
    const sm2 = new SessionManager();
    const s2  = sm2.start("board-1");
    expect(s1.sessionId).toBe(s2.sessionId);
  });
});

describe("SessionManager — resumability", () => {
  it("canResume is false on first start (epoch=1, seq=0)", () => {
    const sm = new SessionManager();
    sm.start("board-1");
    expect(sm.canResume).toBe(false);
  });
  it("canResume is true after ackSequence advances cursor", () => {
    const sm = new SessionManager();
    sm.start("board-1");
    sm.ackSequence("42");
    expect(sm.canResume).toBe(true);
  });
  it("canResume is true after incrementEpoch", () => {
    const sm = new SessionManager();
    sm.start("board-1");
    sm.incrementEpoch();
    expect(sm.canResume).toBe(true);
  });
});

describe("SessionManager — epoch management", () => {
  it("incrementEpoch increases connectionEpoch", () => {
    const sm = new SessionManager();
    sm.start("board-1");
    sm.incrementEpoch();
    expect(sm.connectionEpoch).toBe(2);
    sm.incrementEpoch();
    expect(sm.connectionEpoch).toBe(3);
  });
  it("isCurrentEpoch works correctly", () => {
    const sm = new SessionManager();
    sm.start("board-1");
    expect(sm.isCurrentEpoch(1)).toBe(true);
    expect(sm.isCurrentEpoch(2)).toBe(false);
    sm.incrementEpoch();
    expect(sm.isCurrentEpoch(2)).toBe(true);
    expect(sm.isCurrentEpoch(1)).toBe(false);
  });
  it("throws when incrementEpoch called before start", () => {
    const sm = new SessionManager();
    expect(() => sm.incrementEpoch()).toThrow();
  });
});

describe("SessionManager — sequence tracking", () => {
  it("ackSequence advances lastAckedSequence", () => {
    const sm = new SessionManager();
    sm.start("board-1");
    sm.ackSequence("100");
    expect(sm.lastAckedSequence).toBe("100");
    sm.ackSequence("200");
    expect(sm.lastAckedSequence).toBe("200");
  });
  it("ackSequence is a no-op when called before start", () => {
    const sm = new SessionManager();
    expect(() => sm.ackSequence("100")).not.toThrow();
  });
});

describe("SessionManager — persistence & resume", () => {
  it("persists and resumes lastAckedSequence", () => {
    const sm1 = new SessionManager();
    const s1  = sm1.start("board-1");
    sm1.ackSequence("500");
    const sm2 = new SessionManager();
    const s2  = sm2.start("board-1");
    expect(s2.sessionId).toBe(s1.sessionId);
    expect(s2.lastAckedSequence).toBe("500");
  });
  it("different boardId gets a different session", () => {
    const sm1 = new SessionManager();
    const s1  = sm1.start("board-1");
    const sm2 = new SessionManager();
    const s2  = sm2.start("board-2");
    expect(s1.sessionId).not.toBe(s2.sessionId);
  });
});

describe("SessionManager — clear", () => {
  it("clear() removes persisted session and resets to null", () => {
    const sm = new SessionManager();
    sm.start("board-1");
    sm.clear();
    expect(sm.current).toBeNull();
    const s2 = sm.start("board-1");
    expect(s2.connectionEpoch).toBe(1);
    expect(s2.lastAckedSequence).toBe("0");
  });
});
