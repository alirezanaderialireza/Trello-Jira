// packages/infrastructure/src/auth/liveAcl/wsAclEnforcer.ts
// ─────────────────────────────────────────────────────────────────────────────
// WsAclEnforcer — live ACL enforcement for WebSocket connections.
//
// Listens to the AclInvalidationBus and takes action on live WS connections:
//
//   ACL_MEMBER_REMOVED   → disconnect the affected user's connections
//   ACL_MEMBER_CHANGED   → re-check their permissions; disconnect if downgraded
//                          below the minimum required for the board
//   ACL_BOARD_ARCHIVED   → disconnect ALL connections to that board
//   SESSION_REVOKE       → disconnect the specific session's connections
//
// Integrates with WsSessionManager from Phase 2 infrastructure.
// ─────────────────────────────────────────────────────────────────────────────

import type { WsSessionManager, WsConnection } from "../../ws/wsServer";
import type { AclInvalidationBus, AclInvalidationEvent } from "./aclInvalidationBus";
import type { AclEngine } from "../aclEngine";

export interface WsDisconnectFn {
  (connectionId: string, reason: string): void;
}

export class WsAclEnforcer {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly sessionMgr: WsSessionManager,
    private readonly aclEngine:  AclEngine,
    private readonly bus:         AclInvalidationBus,
    private readonly disconnect:  WsDisconnectFn,
  ) {}

  // Start listening for invalidation events
  start(subRedis: any): void {
    this.unsubscribe = this.bus.subscribe(subRedis, (event) => this.handleEvent(event));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async handleEvent(event: AclInvalidationEvent): Promise<void> {
    switch (event.type) {
      case "ACL_MEMBER_REMOVED":
        await this.handleMemberRemoved(event);
        break;

      case "ACL_MEMBER_CHANGED":
        await this.handleMemberChanged(event);
        break;

      case "ACL_BOARD_ARCHIVED":
        if (event.boardId) this.disconnectBoard(event.boardId, event.tenantId, "BOARD_ARCHIVED");
        break;

      case "SESSION_REVOKE":
        if (event.sessionId) this.disconnectSession(event.sessionId, event.tenantId, "SESSION_REVOKED");
        break;
    }
  }

  private async handleMemberRemoved(event: AclInvalidationEvent): Promise<void> {
    if (!event.boardId || !event.userId) return;
    const connections = this.sessionMgr.getConnectionsForBoard(event.boardId);
    for (const conn of connections) {
      if (conn.userId === event.userId && conn.tenantId === event.tenantId) {
        this.disconnect(conn.id, "MEMBERSHIP_REVOKED");
      }
    }
  }

  private async handleMemberChanged(event: AclInvalidationEvent): Promise<void> {
    if (!event.boardId || !event.userId) return;
    const connections = this.sessionMgr.getConnectionsForBoard(event.boardId);

    for (const conn of connections) {
      if (conn.userId !== event.userId || conn.tenantId !== event.tenantId) continue;

      // Re-check if they still have board:read permission
      const result = await this.aclEngine.check({
        userId:    conn.userId,
        tenantId:  conn.tenantId,
        boardId:   event.boardId,
        permission: "board:read",
      });

      if (!result.allowed) {
        this.disconnect(conn.id, "PERMISSION_DOWNGRADED");
      }
    }
  }

  private disconnectBoard(boardId: string, tenantId: string, reason: string): void {
    const connections = this.sessionMgr.getConnectionsForBoard(boardId);
    for (const conn of connections) {
      if (conn.tenantId === tenantId) {
        this.disconnect(conn.id, reason);
      }
    }
  }

  private disconnectSession(sessionId: string, tenantId: string, reason: string): void {
    // Scan all boards for connections belonging to this session
    const allConns: WsConnection[] = [];
    // WsSessionManager doesn't expose getAllConnections — access via internal map
    (this.sessionMgr as any).connections?.forEach?.((conn: WsConnection) => {
      if (conn.sessionId === sessionId && conn.tenantId === tenantId) {
        allConns.push(conn);
      }
    });
    for (const conn of allConns) {
      this.disconnect(conn.id, reason);
    }
  }
}
