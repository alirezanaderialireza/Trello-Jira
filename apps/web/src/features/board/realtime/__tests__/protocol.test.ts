// apps/web/src/features/board/realtime/__tests__/protocol.test.ts
//
// Phase-1.2 — Protocol contract tests
// Covers Phase-1.1 suite + new v1.1 additions:
//   #1  originMutationId / originSessionId in ServerEvent + ServerEventBatch
//   #2  runtime validators: batch size guard, sequence shape, exhaustive checks
//   #3  dedup constants (DEDUP_WINDOW_MS)
//   #6  AUTH_REQUIRED parsing
//   #7  ServerSubscribed.capabilities

import { describe, it, expect } from "vitest";
import {
  serializeClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  DEDUP_WINDOW_MS,
  MAX_BATCH_SIZE,
  CATCH_UP_MAX_EVENTS,
  BASELINE_CAPABILITIES,
  type ClientConnect,
  type ClientResume,
} from "../protocol";

// ── PROTOCOL_VERSION ─────────────────────────────────────────────────────────
describe("PROTOCOL_VERSION", () => {
  it("is '1.1'", () => { expect(PROTOCOL_VERSION).toBe("1.1"); });
});

// ── Constants (#3) ────────────────────────────────────────────────────────────
describe("Protocol constants", () => {
  it("DEDUP_WINDOW_MS is 24 hours", () => {
    expect(DEDUP_WINDOW_MS).toBe(24 * 60 * 60 * 1_000);
  });
  it("MAX_BATCH_SIZE is 500", () => { expect(MAX_BATCH_SIZE).toBe(500); });
  it("CATCH_UP_MAX_EVENTS is 5000", () => { expect(CATCH_UP_MAX_EVENTS).toBe(5_000); });
});

// ── BASELINE_CAPABILITIES (#7) ────────────────────────────────────────────────
describe("BASELINE_CAPABILITIES", () => {
  it("has batching and replay enabled by default", () => {
    expect(BASELINE_CAPABILITIES.batching).toBe(true);
    expect(BASELINE_CAPABILITIES.replay).toBe(true);
    expect(BASELINE_CAPABILITIES.presence).toBe(false);
    expect(BASELINE_CAPABILITIES.awareness).toBe(false);
    expect(BASELINE_CAPABILITIES.compression).toBe(false);
  });
});

// ── serializeClientMessage ────────────────────────────────────────────────────
describe("serializeClientMessage", () => {
  it("serialises CONNECT with protocolVersion 1.1", () => {
    const msg: ClientConnect = {
      type:            "CONNECT",
      protocolVersion: PROTOCOL_VERSION,
      messageId:       "msg-1",
      boardId:         "board-abc",
    };
    const parsed = JSON.parse(serializeClientMessage(msg));
    expect(parsed.type).toBe("CONNECT");
    expect(parsed.protocolVersion).toBe("1.1");
    expect(parsed.boardId).toBe("board-abc");
  });
  it("serialises RESUME with lastAckedSequence and connectionEpoch", () => {
    const msg: ClientResume = {
      type: "RESUME", protocolVersion: PROTOCOL_VERSION,
      messageId: "msg-2", boardId: "b1", sessionId: "sess-1",
      lastAckedSequence: "1042", connectionEpoch: 3,
    };
    const parsed = JSON.parse(serializeClientMessage(msg));
    expect(parsed.lastAckedSequence).toBe("1042");
    expect(parsed.connectionEpoch).toBe(3);
  });
});

// ── parseServerMessage: invalid input ────────────────────────────────────────
describe("parseServerMessage — invalid input", () => {
  it("returns null for malformed JSON",   () => expect(parseServerMessage("{bad")).toBeNull());
  it("returns null for null JSON",        () => expect(parseServerMessage("null")).toBeNull());
  it("returns null for array JSON",       () => expect(parseServerMessage("[]")).toBeNull());
  it("returns null when type missing",    () => {
    expect(parseServerMessage(JSON.stringify({ messageId: "m1", serverTime: "t" }))).toBeNull();
  });
  it("returns null when serverTime missing", () => {
    expect(parseServerMessage(JSON.stringify({ type: "EVENT", messageId: "m1" }))).toBeNull();
  });
});

// ── parseServerMessage: SUBSCRIBED with capabilities (#7) ────────────────────
describe("parseServerMessage — SUBSCRIBED", () => {
  it("parses with capabilities", () => {
    const msg = {
      type: "SUBSCRIBED", messageId: "m1", serverTime: "2024-01-01T00:00:00Z",
      sessionId: "sess-1", boardId: "board-1", currentSequence: "500",
      connectionEpoch: 2,
      capabilities: { batching: true, replay: true, presence: true, awareness: false, compression: false },
    };
    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed?.type).toBe("SUBSCRIBED");
    if (parsed?.type === "SUBSCRIBED") {
      expect(parsed.capabilities.presence).toBe(true);
    }
  });
  it("defaults capabilities to BASELINE when omitted", () => {
    const msg = {
      type: "SUBSCRIBED", messageId: "m2", serverTime: "2024-01-01T00:00:00Z",
      sessionId: "sess-2", boardId: "b1", currentSequence: "0", connectionEpoch: 1,
    };
    const parsed = parseServerMessage(JSON.stringify(msg));
    if (parsed?.type === "SUBSCRIBED") {
      expect(parsed.capabilities.batching).toBe(true);
    }
  });
  it("returns null when currentSequence is not a digit string", () => {
    const msg = {
      type: "SUBSCRIBED", messageId: "m3", serverTime: "2024-01-01T00:00:00Z",
      sessionId: "s1", boardId: "b1", currentSequence: "abc", connectionEpoch: 1,
    };
    expect(parseServerMessage(JSON.stringify(msg))).toBeNull();
  });
});

// ── parseServerMessage: EVENT with reconciliation metadata (#1) ──────────────
describe("parseServerMessage — EVENT with reconciliation metadata", () => {
  const baseEvent = {
    id: "evt-1", type: "card.updated" as const, version: 2,
    occurredAt: "2024-01-01T00:00:00Z", aggregateId: "c1", aggregateType: "card" as const,
    payload: { cardId: "c1", boardId: "b1", changes: { title: "X" } },
  };

  it("parses EVENT without reconciliation metadata (remote event)", () => {
    const msg = {
      type: "EVENT", messageId: "m1", serverTime: "t", sequence: "101",
      payload: baseEvent,
    };
    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed?.type).toBe("EVENT");
    if (parsed?.type === "EVENT") {
      expect(parsed.originMutationId).toBeUndefined();
      expect(parsed.originSessionId).toBeUndefined();
    }
  });

  it("parses EVENT with originMutationId and originSessionId (#1)", () => {
    const msg = {
      type: "EVENT", messageId: "m2", serverTime: "t", sequence: "102",
      payload: baseEvent,
      originMutationId: "mut-1",
      originSessionId:  "sess-abc",
    };
    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed?.type).toBe("EVENT");
    if (parsed?.type === "EVENT") {
      expect(parsed.originMutationId).toBe("mut-1");
      expect(parsed.originSessionId).toBe("sess-abc");
    }
  });

  it("returns null when sequence is not a digit string (#2)", () => {
    const msg = {
      type: "EVENT", messageId: "m3", serverTime: "t",
      sequence: "not-a-number", payload: baseEvent,
    };
    expect(parseServerMessage(JSON.stringify(msg))).toBeNull();
  });
  it("returns null when sequence is a float string (#2)", () => {
    const msg = {
      type: "EVENT", messageId: "m4", serverTime: "t",
      sequence: "1.5", payload: baseEvent,
    };
    expect(parseServerMessage(JSON.stringify(msg))).toBeNull();
  });
});

// ── parseServerMessage: EVENT_BATCH batch size guard (#2) ────────────────────
describe("parseServerMessage — EVENT_BATCH batch size guard", () => {
  const mkEvent = (seq: number) => ({
    sequence: String(seq),
    payload: { id: `e${seq}`, type: "card.updated", version: 1, occurredAt: "t",
               aggregateId: "c1", aggregateType: "card", payload: {} },
  });

  it("accepts batch within MAX_BATCH_SIZE", () => {
    const msg = {
      type: "EVENT_BATCH", messageId: "m1", serverTime: "t",
      events: [mkEvent(101), mkEvent(102)],
    };
    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed?.type).toBe("EVENT_BATCH");
  });

  it("rejects batch exceeding MAX_BATCH_SIZE (#2)", () => {
    const events = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => mkEvent(i + 1));
    const msg = { type: "EVENT_BATCH", messageId: "m2", serverTime: "t", events };
    expect(parseServerMessage(JSON.stringify(msg))).toBeNull();
  });

  it("rejects EVENT_BATCH with invalid sequence in item (#2)", () => {
    const msg = {
      type: "EVENT_BATCH", messageId: "m3", serverTime: "t",
      events: [{ sequence: "bad", payload: { type: "card.updated" } }],
    };
    expect(parseServerMessage(JSON.stringify(msg))).toBeNull();
  });

  it("parses EVENT_BATCH with originMutationId on items (#1)", () => {
    const msg = {
      type: "EVENT_BATCH", messageId: "m4", serverTime: "t",
      events: [{
        sequence: "103",
        originMutationId: "mut-5",
        originSessionId:  "sess-xyz",
        payload: { id: "e103", type: "card.updated", version: 1, occurredAt: "t",
                   aggregateId: "c1", aggregateType: "card", payload: {} },
      }],
    };
    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed?.type).toBe("EVENT_BATCH");
    if (parsed?.type === "EVENT_BATCH") {
      expect(parsed.events[0].originMutationId).toBe("mut-5");
    }
  });
});

// ── parseServerMessage: AUTH_REQUIRED (#6) ───────────────────────────────────
describe("parseServerMessage — AUTH_REQUIRED", () => {
  it("parses token_expired correctly", () => {
    const msg = {
      type: "AUTH_REQUIRED", messageId: "m1", serverTime: "t",
      code: "token_expired", reason: "JWT expired",
    };
    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed?.type).toBe("AUTH_REQUIRED");
    if (parsed?.type === "AUTH_REQUIRED") {
      expect(parsed.code).toBe("token_expired");
    }
  });
  it("parses insufficient_scope correctly", () => {
    const msg = {
      type: "AUTH_REQUIRED", messageId: "m2", serverTime: "t",
      code: "insufficient_scope", reason: "Need board:write",
    };
    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed?.type).toBe("AUTH_REQUIRED");
  });
  it("returns null when code missing", () => {
    const msg = { type: "AUTH_REQUIRED", messageId: "m3", serverTime: "t", reason: "x" };
    expect(parseServerMessage(JSON.stringify(msg))).toBeNull();
  });
});

// ── parseServerMessage: other types ──────────────────────────────────────────
describe("parseServerMessage — other types", () => {
  it("parses SERVER_ACK", () => {
    const parsed = parseServerMessage(JSON.stringify({
      type: "SERVER_ACK", messageId: "m", serverTime: "t",
      correlationId: "c", mutationId: "mut", sequence: "42",
    }));
    expect(parsed?.type).toBe("SERVER_ACK");
  });
  it("parses SERVER_NACK", () => {
    const parsed = parseServerMessage(JSON.stringify({
      type: "SERVER_NACK", messageId: "m", serverTime: "t",
      correlationId: "c", mutationId: "mut", reason: "err", retryable: true,
    }));
    expect(parsed?.type).toBe("SERVER_NACK");
  });
  it("rejects SERVER_ACK with non-digit sequence (#2)", () => {
    const parsed = parseServerMessage(JSON.stringify({
      type: "SERVER_ACK", messageId: "m", serverTime: "t",
      correlationId: "c", mutationId: "mut", sequence: "abc",
    }));
    expect(parsed).toBeNull();
  });
  it("parses RESYNC_REQUIRED with digit sequences", () => {
    const parsed = parseServerMessage(JSON.stringify({
      type: "RESYNC_REQUIRED", messageId: "m", serverTime: "t",
      reason: "gap", serverSequence: "9000", clientSequence: "42",
    }));
    expect(parsed?.type).toBe("RESYNC_REQUIRED");
  });
  it("parses PONG", () => {
    const parsed = parseServerMessage(JSON.stringify({
      type: "PONG", messageId: "m", serverTime: "t",
      boardId: "b1", roundTripHintMs: 45,
    }));
    expect(parsed?.type).toBe("PONG");
  });
  it("returns null for unknown type (forward compat)", () => {
    const parsed = parseServerMessage(JSON.stringify({
      type: "FUTURE_MESSAGE_TYPE_V2", messageId: "m", serverTime: "t", data: "x",
    }));
    expect(parsed).toBeNull();
  });
});
