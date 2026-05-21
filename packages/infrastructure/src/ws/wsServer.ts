// packages/infrastructure/src/ws/wsServer.ts
// -----------------------------------------------------------------------------
// Production WebSocket server.
//
// Design:
//   - validateWsConnect: verifies RS256 token + board membership before accept
//   - ACL enforcement: "board:read" checked on connect, events only emitted to
//     users with at least VIEWER role on that board
//   - Session propagation: sessionId + jti stored per connection, validated on
//     each event via TokenService.validateSessionJti
//   - User/tenant metadata in every outgoing event (for client-side routing)
//   - Audit: WS connect/disconnect + mutations logged via AuditLogger
//   - Outbox fanout: subscribes to Redis channel "board:{boardId}:events"
//     (populated by OutboxProcessor) and forwards to WS room
//
// NOTE: This is a standalone server (Node.js ws + ioredis).
// It runs in apps/ws-server or can be co-located with the API server.
// -----------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import type { Redis } from "ioredis";
import type { TokenService } from "../auth/tokenService";
import type { AclEngine } from "../auth/aclEngine";
import type { AuditLogger } from "../audit/auditLogger";

// ============================================================================
// Types
// ============================================================================

export interface WsConnection {
  id: string;          // connectionId (UUID)
  sessionId: string;
  userId: string;
  tenantId: string;
  boardId: string;
  jti: string;         // last verified JTI — refreshed on token re-auth
  roles: string[];
  connectedAt: Date;
}

export interface WsOutboundEvent {
  type: string;
  sequence: string;
  payload: Record<string, unknown>;
  // Metadata injected by server — not from client
  meta: {
    timestamp: string;
    tenantId: string;   // for client-side tenant routing
    boardId: string;
    actorId: string;
    correlationId?: string;
  };
}

export interface WsInboundMessage {
  action: "subscribe" | "unsubscribe" | "ping" | "reauth";
  boardId: string;
  lastSequence?: string;
  token?: string;      // JWT for connect/reauth
}

// ============================================================================
// WsSessionManager
// Manages in-memory connection registry + board rooms.
// In multi-node deployments, connections are node-local; Redis pub/sub
// broadcasts events to all nodes so each delivers to its local connections.
// ============================================================================

export class WsSessionManager extends EventEmitter {
  // connectionId → WsConnection
  private readonly connections = new Map<string, WsConnection>();
  // boardId → Set of connectionIds
  private readonly rooms = new Map<string, Set<string>>();

  register(conn: WsConnection): void {
    this.connections.set(conn.id, conn);
    if (!this.rooms.has(conn.boardId)) {
      this.rooms.set(conn.boardId, new Set());
    }
    this.rooms.get(conn.boardId)!.add(conn.id);
  }

  deregister(connectionId: string): WsConnection | undefined {
    const conn = this.connections.get(connectionId);
    if (!conn) return undefined;

    this.connections.delete(connectionId);
    this.rooms.get(conn.boardId)?.delete(connectionId);
    return conn;
  }

  getConnectionsForBoard(boardId: string): WsConnection[] {
    const ids = this.rooms.get(boardId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.connections.get(id))
      .filter((c): c is WsConnection => c !== undefined);
  }

  getConnection(connectionId: string): WsConnection | undefined {
    return this.connections.get(connectionId);
  }

  stats(): { totalConnections: number; rooms: number } {
    return {
      totalConnections: this.connections.size,
      rooms: this.rooms.size,
    };
  }
}

// ============================================================================
// WsAuthHandler
// Handles connection authentication and per-event session validation.
// ============================================================================

export class WsAuthHandler {
  constructor(
    private readonly tokenService: TokenService,
    private readonly aclEngine: AclEngine,
  ) {}

  // ==========================================================================
  // validateWsConnect — called on initial connection.
  // Returns the verified connection metadata or throws.
  // ==========================================================================

  async validateWsConnect(params: {
    token: string;
    boardId: string;
    connectionId: string;
    userAgent?: string;
    ip?: string;
  }): Promise<WsConnection> {
    // 1. Verify JWT signature + expiry + revocation
    let claims;
    try {
      claims = await this.tokenService.verifyAccessToken(params.token);
    } catch (err: any) {
      throw new WsAuthError("INVALID_TOKEN", err.code);
    }

    // 2. Board ACL — must have at least VIEWER
    const aclResult = await this.aclEngine.check({
      userId: claims.sub,
      tenantId: claims.tid,
      boardId: params.boardId,
      permission: "board:read",
    });

    if (!aclResult.allowed) {
      throw new WsAuthError("BOARD_ACCESS_DENIED", `role=${aclResult.role}`);
    }

    // 3. Session JTI consistency
    const jtiValid = await this.tokenService.validateSessionJti({
      sessionId: claims.sid,
      jti: claims.jti,
    });

    if (!jtiValid) {
      throw new WsAuthError("SESSION_INVALID", "jti_mismatch");
    }

    return {
      id: params.connectionId,
      sessionId: claims.sid,
      userId: claims.sub,
      tenantId: claims.tid,
      boardId: params.boardId,
      jti: claims.jti,
      roles: claims.roles,
      connectedAt: new Date(),
    };
  }

  // ==========================================================================
  // revalidateForWs — heartbeat/event guard.
  // Verifies session is still active (not revoked, not expired).
  // Called before emitting each event batch to a connection.
  // ==========================================================================

  async revalidateForWs(conn: WsConnection): Promise<boolean> {
    const valid = await this.tokenService.validateSessionJti({
      sessionId: conn.sessionId,
      jti: conn.jti,
    });
    return valid;
  }
}

// ============================================================================
// WsEventEmitter
// Handles outbound event emission with ACL enforcement.
// Called by OutboxProcessor after each committed event.
// ============================================================================

export class WsEventEmitter {
  constructor(
    private readonly sessionManager: WsSessionManager,
    private readonly authHandler: WsAuthHandler,
    private readonly aclEngine: AclEngine,
    private readonly auditLogger: AuditLogger,
    // send(connectionId, event) — implemented by the transport layer (ws/uws)
    private readonly send: (connectionId: string, event: WsOutboundEvent) => void,
  ) {}

  // ==========================================================================
  // emitToBoardRoom — emit event to all connections subscribed to boardId.
  // Before emitting to each connection:
  //   1. Revalidate session (token not revoked, JTI consistent)
  //   2. Re-check board ACL (role might have been downgraded mid-session)
  //   3. Inject server-side metadata (tenantId, boardId, actorId)
  // ==========================================================================

  async emitToBoardRoom(params: {
    boardId: string;
    tenantId: string;
    event: {
      type: string;
      sequence: string;
      payload: Record<string, unknown>;
      correlationId?: string;
      actorId?: string;
    };
  }): Promise<void> {
    const connections = this.sessionManager.getConnectionsForBoard(params.boardId);

    await Promise.allSettled(
      connections.map(async (conn) => {
        // Guard 1: tenant isolation — never emit cross-tenant
        if (conn.tenantId !== params.tenantId) return;

        // Guard 2: session still valid
        const sessionValid = await this.authHandler.revalidateForWs(conn);
        if (!sessionValid) {
          this.sessionManager.deregister(conn.id);
          return;
        }

        // Guard 3: ACL re-check (role may have changed mid-session)
        const aclResult = await this.aclEngine.check({
          userId: conn.userId,
          tenantId: conn.tenantId,
          boardId: params.boardId,
          permission: "board:read",
        });

        if (!aclResult.allowed) {
          // User's role was revoked — disconnect them
          this.sessionManager.deregister(conn.id);
          return;
        }

        // Emit with server-injected metadata
        const outbound: WsOutboundEvent = {
          type: params.event.type,
          sequence: params.event.sequence,
          payload: params.event.payload,
          meta: {
            timestamp: new Date().toISOString(),
            tenantId: params.tenantId,
            boardId: params.boardId,
            actorId: params.event.actorId ?? "",
            correlationId: params.event.correlationId,
          },
        };

        this.send(conn.id, outbound);
      }),
    );
  }
}

// ============================================================================
// WsAuthError
// ============================================================================

export class WsAuthError extends Error {
  constructor(
    public readonly code:
      | "INVALID_TOKEN"
      | "BOARD_ACCESS_DENIED"
      | "SESSION_INVALID",
    public readonly detail?: string,
  ) {
    super(`${code}: ${detail ?? ""}`);
    this.name = "WsAuthError";
  }
}

// ============================================================================
// buildWorkerSession
// Session context for OutboxProcessor — no HTTP/WS request context.
// Called when worker needs to audit an action or check ACL.
// ============================================================================

export interface WorkerSession {
  userId: "SYSTEM";
  tenantId: string;
  source: "WORKER";
  correlationId: string;
  traceId?: string;
}

export function buildWorkerSession(params: {
  tenantId: string;
  correlationId: string;
  traceId?: string;
}): WorkerSession {
  return {
    userId: "SYSTEM",
    tenantId: params.tenantId,
    source: "WORKER",
    correlationId: params.correlationId,
    traceId: params.traceId,
  };
}
