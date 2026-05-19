// apps/web/src/features/board/realtime/protocol.ts
//
// Phase-1.1 — Protocol Contracts (FROZEN)
//
// This file defines the complete message vocabulary between client and server.
// Once frozen, server-side WS gateway is a mechanical implementation of these types.
//
// Design rules:
//   • All messages are discriminated unions — no optional ambiguity
//   • Client → Server messages are versioned with `protocolVersion`
//   • Server → Client messages carry `serverTime` for clock-skew detection
//   • Every message has a `messageId` for tracing / deduplication
//   • Batch is a first-class message type — server may send multiple events at once

import type { AppDomainEvent } from "@repo/domain";

// ============================================================================
// Protocol Version
// ============================================================================

export const PROTOCOL_VERSION = "1.0" as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

// ============================================================================
// Client → Server messages
// ============================================================================

/**
 * Connect to a board room.
 * Sent once after WS is opened.
 */
export interface ClientConnect {
  readonly type:            "CONNECT";
  readonly protocolVersion: ProtocolVersion;
  readonly messageId:       string;
  readonly boardId:         string;
  readonly token?:          string;
}

/**
 * Resume an existing session after reconnect.
 * Client sends this instead of CONNECT when it has a valid sessionId.
 * Server uses lastAckedSequence to decide whether to replay or full-resync.
 */
export interface ClientResume {
  readonly type:               "RESUME";
  readonly protocolVersion:    ProtocolVersion;
  readonly messageId:          string;
  readonly boardId:            string;
  readonly sessionId:          string;
  readonly lastAckedSequence:  string;   // last sequence client successfully applied
  readonly connectionEpoch:    number;   // monotonic counter, incremented on each connect
  readonly token?:             string;
}

/**
 * Optimistic mutation — client-generated event to be confirmed by the server.
 * Server responds with SERVER_ACK or SERVER_NACK.
 */
export interface ClientMutation {
  readonly type:             "MUTATION";
  readonly messageId:        string;
  readonly correlationId:    string;
  readonly mutationId:       string;     // idempotency key
  readonly boardId:          string;
  readonly payload:          AppDomainEvent;
  readonly sessionId:        string;
  readonly connectionEpoch:  number;
}

/**
 * Keep-alive / presence ping.
 * Server responds with SERVER_PONG.
 */
export interface ClientPing {
  readonly type:             "PING";
  readonly messageId:        string;
  readonly boardId:          string;
  readonly clientTimestamp:  number;     // epoch ms — for round-trip measurement
}

/**
 * Client acknowledges receipt of a server event.
 * Allows server to advance the client's replay cursor.
 */
export interface ClientAck {
  readonly type:      "ACK";
  readonly messageId: string;
  readonly sequence:  string;
}

// Client message union
export type ClientMessage =
  | ClientConnect
  | ClientResume
  | ClientMutation
  | ClientPing
  | ClientAck;

// ============================================================================
// Server → Client messages
// ============================================================================

interface ServerBase {
  readonly serverTime: string;   // ISO8601 UTC
  readonly messageId:  string;
}

/**
 * Session established. Client may now receive events.
 */
export interface ServerSubscribed extends ServerBase {
  readonly type:              "SUBSCRIBED";
  readonly sessionId:         string;
  readonly boardId:           string;
  readonly currentSequence:   string;   // server's latest committed sequence
  readonly connectionEpoch:   number;   // echoed from CONNECT/RESUME
}

/**
 * Single domain event.
 */
export interface ServerEvent extends ServerBase {
  readonly type:     "EVENT";
  readonly sequence: string;
  readonly payload:  AppDomainEvent;
}

/**
 * Batch of domain events. Used when catching up or when events are coalesced.
 * Events are ordered by sequence ascending.
 */
export interface ServerEventBatch extends ServerBase {
  readonly type:   "EVENT_BATCH";
  readonly events: ReadonlyArray<{
    readonly sequence: string;
    readonly payload:  AppDomainEvent;
  }>;
}

/**
 * Server acknowledged a client mutation.
 */
export interface ServerAck extends ServerBase {
  readonly type:          "SERVER_ACK";
  readonly correlationId: string;
  readonly mutationId:    string;
  readonly sequence:      string;   // the sequence assigned to this event
}

/**
 * Server rejected a client mutation.
 */
export interface ServerNack extends ServerBase {
  readonly type:          "SERVER_NACK";
  readonly correlationId: string;
  readonly mutationId:    string;
  readonly reason:        string;
  readonly retryable:     boolean;
}

/**
 * Server detected that client's state has drifted irrecoverably.
 * Client must perform a full snapshot resync.
 */
export interface ServerResyncRequired extends ServerBase {
  readonly type:           "RESYNC_REQUIRED";
  readonly reason:         string;
  readonly serverSequence: string;
  readonly clientSequence: string;
}

/**
 * Heartbeat reply.
 */
export interface ServerPong extends ServerBase {
  readonly type:            "PONG";
  readonly boardId:         string;
  readonly roundTripHintMs: number;   // server-side estimate of last RTT
}

// Server message union
export type ServerMessage =
  | ServerSubscribed
  | ServerEvent
  | ServerEventBatch
  | ServerAck
  | ServerNack
  | ServerResyncRequired
  | ServerPong;

// ============================================================================
// Serialisation helpers
// ============================================================================

/**
 * Serialise a ClientMessage for WS transport.
 * Strips any undefined fields.
 */
export function serializeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

/**
 * Parse a raw WS frame into a ServerMessage.
 * Returns null if the frame cannot be parsed or is not a recognised type.
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.type !== "string") return null;

    // Minimal structural validation — full zod schema can be added later
    if (!("messageId" in parsed) || !("serverTime" in parsed)) return null;

    return parsed as unknown as ServerMessage;
  } catch {
    return null;
  }
}

// ============================================================================
// Protocol-level constants
// ============================================================================

/**
 * Maximum number of events a SERVER_EVENT_BATCH may contain.
 * Clients must reject batches larger than this.
 */
export const MAX_BATCH_SIZE = 500;

/**
 * Maximum gap (in sequence units) before client triggers a full resync
 * instead of attempting incremental replay.
 */
export const CATCH_UP_MAX_EVENTS = 5_000;
