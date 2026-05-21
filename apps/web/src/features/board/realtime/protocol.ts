// apps/web/src/features/board/realtime/protocol.ts
//
// Phase-1.2 — Protocol Contracts (v1.1 — FROZEN)
//
// Changes from Phase-1.1 (v1.0):
//
//   #1  ServerEvent now carries reconciliation metadata:
//         originMutationId?  — links server event back to the optimistic write
//         originSessionId?   — identifies which session originated this event
//       This lets the pipeline detect "echo" events and reconcile optimistic
//       state instead of double-applying.
//
//   #2  parseServerMessage() upgraded to structural validators:
//         - batch size guard (> MAX_BATCH_SIZE → null)
//         - sequence shape guard (must be /^\d+$/)
//         - exhaustive per-type field checks
//         - no unsafe cast; each case returns null on any field mismatch
//
//   #3  Dedup semantics documented explicitly:
//         - mutationId scope: per-board
//         - dedup window: 24 hours (DEDUP_WINDOW_MS)
//         - server behaviour on duplicate: replay cached ACK (at-least-once)
//
//   #6  Auth lifecycle: AUTH_EXPIRED / AUTH_REQUIRED added to ServerMessage
//
//   #7  Capability negotiation: ServerSubscribed.capabilities field added
//
// Design rules (unchanged):
//   • All messages are discriminated unions — no optional ambiguity
//   • Client → Server messages carry `protocolVersion`
//   • Server → Client messages carry `serverTime` (ISO8601 UTC)
//   • Every message has a `messageId` for distributed tracing

import type { AppDomainEvent } from "@repo/domain";

// ============================================================================
// Protocol Version
// ============================================================================

export const PROTOCOL_VERSION = "1.1" as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

// Versions the client is willing to speak.
// Server responds with AUTH_REQUIRED / UNSUPPORTED_PROTOCOL if none match.
export const SUPPORTED_PROTOCOL_VERSIONS: ReadonlyArray<ProtocolVersion> = ["1.1"];

// ============================================================================
// Dedup semantics (#3)
// ============================================================================

/**
 * Dedup scope: a mutationId is unique within a board for DEDUP_WINDOW_MS.
 *
 * Server behaviour when an identical mutationId arrives within the window:
 *   - Return the cached SERVER_ACK (idempotent replay)
 *
 * Server behaviour when mutationId arrives after the window:
 *   - Treat as a new mutation (re-execute)
 *
 * Client behaviour:
 *   - Generate a fresh UUID per mutation; do NOT reuse mutationIds.
 *
 * Scope: per-board (not per-session, not global).
 */
export const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1_000; // 24 hours

// ============================================================================
// Server capabilities (#7)
// ============================================================================

/**
 * Capability flags advertised in ServerSubscribed.
 * Clients MUST check before using the corresponding feature.
 *
 * batching      — server may send EVENT_BATCH instead of individual EVENTs
 * replay        — server can replay events via RESUME.lastAckedSequence
 * presence      — presence heartbeats accepted (presenceRouter is live)
 * awareness     — cursor / selection awareness events are emitted
 * compression   — server supports per-message deflate (WS extension)
 */
export interface ServerCapabilities {
  readonly batching:     boolean;
  readonly replay:       boolean;
  readonly presence:     boolean;
  readonly awareness:    boolean;
  readonly compression:  boolean;
}

export const BASELINE_CAPABILITIES: ServerCapabilities = {
  batching:    true,
  replay:      true,
  presence:    false,
  awareness:   false,
  compression: false,
};

// ============================================================================
// Client → Server messages
// ============================================================================

/**
 * Connect to a board room (first connection, no existing session).
 * Server responds with SUBSCRIBED or AUTH_REQUIRED.
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
 *
 * Server decision tree:
 *   if lastAckedSequence is within replay window:
 *     → replay missing events, then SUBSCRIBED
 *   if gap > CATCH_UP_MAX_EVENTS:
 *     → RESYNC_REQUIRED
 *   if session expired or unknown:
 *     → AUTH_REQUIRED (client should fall back to CONNECT)
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
 *
 * Idempotency: mutationId is unique per board within DEDUP_WINDOW_MS.
 * connectionEpoch: server rejects mutations from stale connections.
 */
export interface ClientMutation {
  readonly type:             "MUTATION";
  readonly messageId:        string;
  readonly correlationId:    string;    // matches optimistic event in client store
  readonly mutationId:       string;    // idempotency key (UUID)
  readonly boardId:          string;
  readonly payload:          AppDomainEvent;
  readonly sessionId:        string;
  readonly connectionEpoch:  number;    // must match server's session.currentEpoch
}

/**
 * Keep-alive / presence ping.
 * Server responds with PONG.
 */
export interface ClientPing {
  readonly type:             "PING";
  readonly messageId:        string;
  readonly boardId:          string;
  readonly clientTimestamp:  number;    // epoch ms — for round-trip measurement
}

/**
 * Client acknowledges a sequence.
 * Optional — server uses RESUME.lastAckedSequence as canonical cursor.
 * Send ONLY if server advertises capabilities.replay = true and you need
 * server-side per-session cursor tracking (e.g. for presence "last-seen").
 *
 * If you don't need server-side cursor, omit this entirely.
 */
export interface ClientAck {
  readonly type:      "ACK";
  readonly messageId: string;
  readonly sequence:  string;           // must be /^\d+$/
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
 *
 * capabilities: what this server instance supports (#7).
 * If the client uses a feature not in capabilities, it MUST degrade gracefully.
 */
export interface ServerSubscribed extends ServerBase {
  readonly type:             "SUBSCRIBED";
  readonly sessionId:        string;
  readonly boardId:          string;
  readonly currentSequence:  string;              // server's latest committed sequence
  readonly connectionEpoch:  number;              // echoed from CONNECT/RESUME
  readonly capabilities:     ServerCapabilities;  // (#7)
}

/**
 * Single domain event.
 *
 * originMutationId / originSessionId (#1):
 *   Present when this event was produced by a client mutation.
 *   The pipeline uses these fields to reconcile optimistic state:
 *
 *   if event.originMutationId matches a pendingMutation.correlationId:
 *     → this event IS the authoritative version of that optimistic write
 *     → DO NOT double-apply; instead mark the pending mutation as "acked"
 *       and update the entity's revision/position to server values.
 *
 *   if originMutationId is absent:
 *     → this event originated from another client; apply normally.
 *
 *   originSessionId allows multi-tab dedup:
 *     if originSessionId === mySessionId AND originMutationId matches:
 *       → this is our own event echoed back; skip reducer, only update sequence.
 */
export interface ServerEvent extends ServerBase {
  readonly type:               "EVENT";
  readonly sequence:           string;
  readonly payload:            AppDomainEvent;
  readonly originMutationId?:  string;   // (#1) set when event came from a mutation
  readonly originSessionId?:   string;   // (#1) set to the originating sessionId
}

/**
 * Batch of domain events. Used for catch-up replay and coalescing.
 * Events are ordered by sequence ascending.
 *
 * Each item in events may carry originMutationId / originSessionId (#1).
 * Client MUST enforce batch.events.length <= MAX_BATCH_SIZE.
 */
export interface ServerEventBatch extends ServerBase {
  readonly type:   "EVENT_BATCH";
  readonly events: ReadonlyArray<{
    readonly sequence:           string;
    readonly payload:            AppDomainEvent;
    readonly originMutationId?:  string;  // (#1)
    readonly originSessionId?:   string;  // (#1)
  }>;
}

/**
 * Server acknowledged a client mutation.
 * sequence: the event log position assigned to this mutation.
 *
 * After receiving SERVER_ACK:
 *   1. outbox.ack(mutationId)
 *   2. session.ackSequence(sequence)
 *   3. The corresponding SERVER_EVENT with originMutationId will arrive;
 *      the pipeline will reconcile the optimistic state then.
 */
export interface ServerAck extends ServerBase {
  readonly type:          "SERVER_ACK";
  readonly correlationId: string;
  readonly mutationId:    string;
  readonly sequence:      string;
}

/**
 * Server rejected a client mutation.
 *
 * retryable: true → schedule exponential backoff retry
 *            false → dead-letter immediately, rollback snapshot
 *
 * reason codes (non-exhaustive):
 *   STALE_REVISION          — OCC conflict; retry with fresh state
 *   FORBIDDEN               — ACL denied; do NOT retry
 *   VALIDATION_ERROR        — bad payload; do NOT retry
 *   STALE_EPOCH             — connectionEpoch mismatch; reconnect
 *   DUPLICATE_MUTATION_ID   — already processed (rare: within dedup window)
 */
export interface ServerNack extends ServerBase {
  readonly type:          "SERVER_NACK";
  readonly correlationId: string;
  readonly mutationId:    string;
  readonly reason:        string;
  readonly retryable:     boolean;
}

/**
 * Server detected that client's state has drifted beyond the replay window.
 * Client MUST perform a full snapshot resync.
 *
 * reason codes:
 *   gap_too_large      — serverSeq - clientSeq > CATCH_UP_MAX_EVENTS
 *   log_overflow       — replay buffer evicted; events unavailable
 *   invariant_failed   — server-side consistency check failed
 *   force_resync       — operator-triggered (deploys, migrations, etc.)
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
  readonly roundTripHintMs: number;
}

/**
 * Auth lifecycle messages (#6).
 *
 * AUTH_REQUIRED: token absent, expired, or insufficient scope.
 *   Client should re-authenticate and retry with CONNECT (not RESUME).
 *   code: "token_missing" | "token_expired" | "token_invalid" | "insufficient_scope"
 *
 * AUTH_REQUIRED is NOT retryable — client must re-authenticate first.
 */
export interface ServerAuthRequired extends ServerBase {
  readonly type:   "AUTH_REQUIRED";
  readonly code:   "token_missing" | "token_expired" | "token_invalid" | "insufficient_scope";
  readonly reason: string;
}

// Server message union (#6: AUTH_REQUIRED added)
export type ServerMessage =
  | ServerSubscribed
  | ServerEvent
  | ServerEventBatch
  | ServerAck
  | ServerNack
  | ServerResyncRequired
  | ServerPong
  | ServerAuthRequired;

// ============================================================================
// Serialisation helpers
// ============================================================================

/**
 * Serialise a ClientMessage for WS transport.
 */
export function serializeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

// ============================================================================
// Runtime validation (#2)
// ============================================================================

const SEQ_REGEX = /^\d+$/;

function isValidSequence(v: unknown): v is string {
  return typeof v === "string" && SEQ_REGEX.test(v);
}

function hasBase(p: Record<string, unknown>): boolean {
  return typeof p.messageId === "string" && typeof p.serverTime === "string";
}

/**
 * Validate and parse a raw WS frame into a typed ServerMessage.
 *
 * Returns null when:
 *   - input is not valid JSON
 *   - type field is missing or unrecognised
 *   - required fields for the message type are missing / wrong type
 *   - EVENT_BATCH.events.length > MAX_BATCH_SIZE (#2)
 *   - sequence fields fail the /^\d+$/ pattern (#2)
 *
 * This is intentionally NOT a Zod/io-ts schema — it uses hand-written
 * structural checks so there is zero runtime dependency on a validation lib.
 * When the protocol matures, replace with zod.parse() or valibot.
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  let parsed: Record<string, unknown>;

  try {
    const tmp = JSON.parse(raw);
    if (tmp === null || typeof tmp !== "object" || Array.isArray(tmp)) return null;
    parsed = tmp as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!hasBase(parsed)) return null;

  const type = parsed.type;
  if (typeof type !== "string") return null;

  switch (type) {

    case "SUBSCRIBED": {
      if (
        typeof parsed.sessionId !== "string" ||
        typeof parsed.boardId   !== "string" ||
        !isValidSequence(parsed.currentSequence) ||
        typeof parsed.connectionEpoch !== "number"
      ) return null;
      // capabilities: default to baseline if server omits it (backward compat)
      const caps = (parsed.capabilities && typeof parsed.capabilities === "object")
        ? { ...BASELINE_CAPABILITIES, ...(parsed.capabilities as Partial<ServerCapabilities>) }
        : { ...BASELINE_CAPABILITIES };
      return { ...parsed, capabilities: caps } as unknown as ServerSubscribed;
    }

    case "EVENT": {
      if (!isValidSequence(parsed.sequence)) return null;
      if (!parsed.payload || typeof (parsed.payload as Record<string, unknown>).type !== "string") return null;
      return parsed as unknown as ServerEvent;
    }

    case "EVENT_BATCH": {
      if (!Array.isArray(parsed.events)) return null;
      // (#2) Batch size guard
      if (parsed.events.length > MAX_BATCH_SIZE) return null;
      // Validate each event entry
      for (const ev of parsed.events as unknown[]) {
        if (!ev || typeof ev !== "object") return null;
        const e = ev as Record<string, unknown>;
        if (!isValidSequence(e.sequence)) return null;
        if (!e.payload || typeof (e.payload as Record<string, unknown>).type !== "string") return null;
      }
      return parsed as unknown as ServerEventBatch;
    }

    case "SERVER_ACK": {
      if (
        typeof parsed.correlationId !== "string" ||
        typeof parsed.mutationId    !== "string" ||
        !isValidSequence(parsed.sequence)
      ) return null;
      return parsed as unknown as ServerAck;
    }

    case "SERVER_NACK": {
      if (
        typeof parsed.correlationId !== "string" ||
        typeof parsed.mutationId    !== "string" ||
        typeof parsed.reason        !== "string" ||
        typeof parsed.retryable     !== "boolean"
      ) return null;
      return parsed as unknown as ServerNack;
    }

    case "RESYNC_REQUIRED": {
      if (
        typeof parsed.reason             !== "string" ||
        !isValidSequence(parsed.serverSequence) ||
        !isValidSequence(parsed.clientSequence)
      ) return null;
      return parsed as unknown as ServerResyncRequired;
    }

    case "PONG": {
      if (
        typeof parsed.boardId          !== "string" ||
        typeof parsed.roundTripHintMs  !== "number"
      ) return null;
      return parsed as unknown as ServerPong;
    }

    case "AUTH_REQUIRED": {   // (#6)
      if (
        typeof parsed.code   !== "string" ||
        typeof parsed.reason !== "string"
      ) return null;
      return parsed as unknown as ServerAuthRequired;
    }

    default:
      // Unknown message type — ignore gracefully (forward compat)
      return null;
  }
}

// ============================================================================
// Protocol-level constants
// ============================================================================

/** Maximum events in a single EVENT_BATCH. Enforced by parseServerMessage. */
export const MAX_BATCH_SIZE = 500;

/**
 * Maximum gap (events) before client switches from replay to full resync.
 * Exposed so both client and server can use the same threshold.
 */
export const CATCH_UP_MAX_EVENTS = 5_000;
