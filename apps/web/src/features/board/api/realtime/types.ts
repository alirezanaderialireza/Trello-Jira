// apps/web/src/features/board/api/realtime/types.ts
//
// Phase-0 fix #1 — WsEvent unified source of truth.
//
// Previously WsEvent was defined twice:
//   • apps/web/src/features/board/api/realtime/types.ts  (payload: any)
//   • apps/web/src/features/board/store/useBoardStore.ts (payload: AppDomainEvent)
//
// useBoardStore.ts re-exported WsEvent used by reconcileIncomingEvent, but
// types.ts had `payload: any` which bypassed all type checking at the WS
// ingress boundary.
//
// Fix: canonical WsEvent with payload: AppDomainEvent lives here.
//      useBoardStore.ts re-exports it from this file (no duplicate).

import type { AppDomainEvent } from "@repo/domain";

// ============================================================================
// ⭐ Canonical WsEvent — single source of truth
// ============================================================================

/**
 * A raw message arriving over the WebSocket transport layer.
 *
 * sequence  — bigint-safe decimal string; globally monotonic per board.
 * type      — mirrors the DomainEvent.type — used for quick routing without
 *             deserialising the full payload.
 * payload   — fully typed AppDomainEvent; never `any`.
 */
export interface WsEvent {
  readonly sequence: string;        // bigint-safe decimal string e.g. "1042"
  readonly type:     string;        // mirrors AppDomainEvent.type
  readonly payload:  AppDomainEvent;
}

// ============================================================================
// WebSocket message types (server → client)
// ============================================================================

export type WsMessageType =
  | "SUBSCRIBE"       // client subscription request
  | "UNSUBSCRIBE"     // cancel subscription
  | "EVENT"           // domain event payload
  | "SYSTEM"          // system messages (errors, confirmations)
  | "HEARTBEAT"       // keep-alive
  | "RESYNC_REQUIRED"; // server ordering gap unrecoverable

/**
 * Full envelope received from the WebSocket server.
 */
export interface RealtimeMessage {
  type:      WsMessageType;
  sequence?: string;
  payload?:  AppDomainEvent;
  meta?: {
    timestamp:    string;
    reason?:      string;
    connectionId?: string;
  };
}

/**
 * Message sent from client to WebSocket server.
 */
export interface RealtimeRequest {
  action:        "subscribe" | "unsubscribe" | "ping";
  boardId:       string;
  lastSequence?: string;
  token?:        string;
}

// ============================================================================
// Connection status
// ============================================================================

export type RealtimeStatus =
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "RECONNECTING"
  | "SUBSCRIBED"
  | "ERROR";

// ============================================================================
// Sequence gap analysis
// ============================================================================

export interface SequenceGap {
  detected:     boolean;
  missingCount: number;
  expectedSeq:  bigint;
  receivedSeq:  bigint;
}
