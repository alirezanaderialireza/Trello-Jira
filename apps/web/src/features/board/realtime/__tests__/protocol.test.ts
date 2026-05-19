// apps/web/src/features/board/realtime/__tests__/protocol.test.ts
//
// Phase-1.1 — Protocol contract tests
// Covers: serializeClientMessage, parseServerMessage, message shapes

import { describe, it, expect } from "vitest";
import {
  serializeClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  MAX_BATCH_SIZE,
  CATCH_UP_MAX_EVENTS,
  type ClientConnect,
  type ClientResume,
  type ServerEvent,
  type ServerAck,
  type ServerNack,
} from "../protocol";

// ============================================================================

describe("PROTOCOL_VERSION", () => {
  it("is '1.0'", () => {
    expect(PROTOCOL_VERSION).toBe("1.0");
  });
});

describe("serializeClientMessage", () => {
  it("serialises CONNECT message to JSON", () => {
    const msg: ClientConnect = {
      type:            "CONNECT",
      protocolVersion: PROTOCOL_VERSION,
      messageId:       "msg-1",
      boardId:         "board-abc",
    };

    const json  = serializeClientMessage(msg);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe("CONNECT");
    expect(parsed.protocolVersion).toBe("1.0");
    expect(parsed.boardId).toBe("board-abc");
    expect(parsed.messageId).toBe("msg-1");
  });

  it("serialises RESUME message", () => {
    const msg: ClientResume = {
      type:               "RESUME",
      protocolVersion:    PROTOCOL_VERSION,
      messageId:          "msg-2",
      boardId:            "board-xyz",
      sessionId:          "sess-1",
      lastAckedSequence:  "1042",
      connectionEpoch:    3,
    };

    const parsed = JSON.parse(serializeClientMessage(msg));
    expect(parsed.type).toBe("RESUME");
    expect(parsed.lastAckedSequence).toBe("1042");
    expect(parsed.connectionEpoch).toBe(3);
  });
});

describe("parseServerMessage", () => {
  it("returns null for malformed JSON", () => {
    expect(parseServerMessage("{bad")).toBeNull();
    expect(parseServerMessage("null")).toBeNull();
    expect(parseServerMessage("42")).toBeNull();
  });

  it("returns null when type is missing", () => {
    const raw = JSON.stringify({ messageId: "m1", serverTime: "t" });
    // type is missing
    expect(parseServerMessage(JSON.stringify({ messageId: "m1", serverTime: "t" }))).toBeNull();
  });

  it("returns null when required base fields missing", () => {
    // Missing serverTime
    const raw = JSON.stringify({ type: "EVENT", messageId: "m1" });
    expect(parseServerMessage(raw)).toBeNull();
  });

  it("parses valid SERVER_EVENT", () => {
    const msg = {
      type:       "EVENT",
      messageId:  "m1",
      serverTime: "2024-01-01T00:00:00Z",
      sequence:   "101",
      payload: {
        id:            "evt-1",
        type:          "card.updated",
        version:       2,
        occurredAt:    "2024-01-01T00:00:00Z",
        aggregateId:   "c1",
        aggregateType: "card",
        payload:       { cardId: "c1", boardId: "b1", changes: { title: "X" } },
      },
    };

    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("EVENT");
  });

  it("parses SERVER_ACK", () => {
    const msg = {
      type:          "SERVER_ACK",
      messageId:     "m2",
      serverTime:    "2024-01-01T00:00:00Z",
      correlationId: "corr-1",
      mutationId:    "mut-1",
      sequence:      "102",
    };

    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed?.type).toBe("SERVER_ACK");
  });

  it("parses SERVER_NACK", () => {
    const msg = {
      type:          "SERVER_NACK",
      messageId:     "m3",
      serverTime:    "2024-01-01T00:00:00Z",
      correlationId: "corr-2",
      mutationId:    "mut-2",
      reason:        "STALE_REVISION",
      retryable:     true,
    };

    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed?.type).toBe("SERVER_NACK");
  });

  it("parses PONG", () => {
    const msg = {
      type:             "PONG",
      messageId:        "m4",
      serverTime:       "2024-01-01T00:00:00Z",
      boardId:          "board-1",
      roundTripHintMs:  45,
    };

    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed?.type).toBe("PONG");
  });

  it("parses RESYNC_REQUIRED", () => {
    const msg = {
      type:            "RESYNC_REQUIRED",
      messageId:       "m5",
      serverTime:      "2024-01-01T00:00:00Z",
      reason:          "log_overflow",
      serverSequence:  "9000",
      clientSequence:  "42",
    };

    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed?.type).toBe("RESYNC_REQUIRED");
  });

  it("parses SUBSCRIBED", () => {
    const msg = {
      type:             "SUBSCRIBED",
      messageId:        "m6",
      serverTime:       "2024-01-01T00:00:00Z",
      sessionId:        "sess-1",
      boardId:          "board-1",
      currentSequence:  "500",
      connectionEpoch:  2,
    };

    const parsed = parseServerMessage(JSON.stringify(msg));
    expect(parsed?.type).toBe("SUBSCRIBED");
  });
});

describe("Protocol constants", () => {
  it("MAX_BATCH_SIZE is 500", () => {
    expect(MAX_BATCH_SIZE).toBe(500);
  });

  it("CATCH_UP_MAX_EVENTS is 5000", () => {
    expect(CATCH_UP_MAX_EVENTS).toBe(5_000);
  });
});
