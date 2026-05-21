// packages/api/src/middleware/authMiddleware.ts
//
// ============================================================================
// 🛡️ AuthMiddleware — Central Auth for tRPC + WebSocket
// ============================================================================
//
// Responsibilities:
//   1. Extract Bearer token from request / WS message
//   2. Delegate to SessionPropagator for full validation
//   3. Load board-level role from MembershipCache when boardId is present
//   4. Inject PropagatedSession + BoardRole into the tRPC context
//   5. Rate-limit authentication attempts per IP
//   6. Log failed auth attempts for anomaly detection
//
// Usage — tRPC:
//   Built into the `protectedProcedure` pipeline in trpc.ts.
//   Procedures that need a board role use `boardScopedProcedure`.
//
// Usage — WebSocket (external WS gateway):
//   The WS gateway calls `AuthMiddleware.validateWsConnect(msg)` on CONNECT.
//   On each heartbeat it calls `AuthMiddleware.revalidateWs(session)`.
//
// ============================================================================

import { TRPCError }         from "@trpc/server";
import type { Redis }         from "ioredis";
import type { SessionPropagator, PropagatedSession } from "../auth/sessionPropagation";
import type { MembershipCache }                      from "../acl/membershipCache";
import type { BoardRole }                            from "../acl/aclEngine";
import { AclEngine }                                 from "../acl/aclEngine";

// ============================================================================
// Types
// ============================================================================

export interface WsConnectMessage {
  action:       "subscribe" | "unsubscribe" | "ping";
  boardId:      string;
  token?:       string;
  lastSequence?: string;
}

export interface WsAuthResult {
  session:   PropagatedSession;
  boardRole: BoardRole;
}

// ============================================================================
// AuthMiddleware
// ============================================================================

export class AuthMiddleware {
  private readonly acl = new AclEngine();

  constructor(
    private readonly propagator:      SessionPropagator,
    private readonly membershipCache: MembershipCache,
    private readonly redis:           Redis,
    private readonly logger: {
      warn(payload: Record<string, unknown>): void;
      info(payload: Record<string, unknown>): void;
    },
  ) {}

  // ==========================================================================
  // 🔒 validateHttpRequest
  // ==========================================================================

  /**
   * Called from createContext in trpc.ts for every HTTP request.
   * Returns null if no Authorization header is present (public procedure).
   * Throws TRPCError on invalid/revoked tokens.
   */
  async validateHttpRequest(opts: {
    authorization: string | undefined;
    ip?:           string;
    userAgent?:    string;
  }): Promise<PropagatedSession | null> {
    if (!opts.authorization) return null;

    // Rate limit: 60 failed auth attempts per IP per minute
    await this._enforceRateLimit(opts.ip ?? "unknown", opts.authorization);

    try {
      return await this.propagator.validateAndPropagate({
        authorization: opts.authorization,
        source:        "http",
        ip:            opts.ip,
        userAgent:     opts.userAgent,
        strictAclCheck: false,
      });
    } catch (err: any) {
      this._logAuthFailure("http", opts.ip, err.message);
      throw new TRPCError({
        code:    err.code === "MISSING_TOKEN" ? "UNAUTHORIZED"
               : err.code === "REVOKED_TOKEN" ? "UNAUTHORIZED"
               : "UNAUTHORIZED",
        message: "Authentication failed.",
      });
    }
  }

  // ==========================================================================
  // 🔒 validateWsConnect
  // ==========================================================================

  /**
   * Validate a WebSocket CONNECT/SUBSCRIBE message.
   * Returns the session + board-level role so the WS gateway can decide
   * whether to allow the subscription.
   */
  async validateWsConnect(
    msg:  WsConnectMessage,
    ip?:  string,
  ): Promise<WsAuthResult> {
    // Validate token
    let session: PropagatedSession;
    try {
      session = await this.propagator.validateAndPropagate({
        authorization: msg.token ? `Bearer ${msg.token}` : undefined,
        source:        "ws",
        ip,
        strictAclCheck: false,
      });
    } catch (err: any) {
      this._logAuthFailure("ws", ip, err.message);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "WS auth failed." });
    }

    // Load board role
    const boardRole = await this.membershipCache.getRole(
      session.tenantId,
      msg.boardId,
      session.userId,
    );

    // Deny NONE role (user is not a board member)
    if (boardRole === "NONE") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this board." });
    }

    // Must have at least VIEW_BOARD
    this.acl.assertBoard(boardRole, "VIEW_BOARD", {
      boardId: msg.boardId,
      userId:  session.userId,
    });

    return { session, boardRole };
  }

  // ==========================================================================
  // 🔄 revalidateWs
  // ==========================================================================

  /**
   * Lightweight heartbeat re-validation for an active WS session.
   * Returns updated ACL info if permissions changed.
   */
  async revalidateWs(
    session: PropagatedSession,
    boardId: string,
  ): Promise<{
    valid:       boolean;
    aclChanged:  boolean;
    newBoardRole?: BoardRole;
    newAclVersion?: number;
  }> {
    const result = await this.propagator.revalidateForWs(session);

    if (!result.valid) return { valid: false, aclChanged: false };

    if (!result.aclChanged) return { valid: true, aclChanged: false };

    // ACL changed — re-load the board role
    const newBoardRole = await this.membershipCache.getRole(
      session.tenantId,
      boardId,
      session.userId,
    );

    // If user lost access, signal disconnect
    if (newBoardRole === "NONE") {
      return { valid: false, aclChanged: true, newBoardRole };
    }

    return {
      valid:          true,
      aclChanged:     true,
      newBoardRole,
      newAclVersion:  result.newAclVersion,
    };
  }

  // ==========================================================================
  // 📋 getBoardRole — called by board-scoped tRPC procedures
  // ==========================================================================

  async getBoardRole(
    session:  PropagatedSession,
    boardId:  string,
  ): Promise<BoardRole> {
    return await this.membershipCache.getRole(
      session.tenantId,
      boardId,
      session.userId,
    );
  }

  // ==========================================================================
  // 🔧 Internal helpers
  // ==========================================================================

  /**
   * Sliding window rate limiter for auth attempts per IP.
   * Throws TRPCError if the limit is exceeded.
   */
  private async _enforceRateLimit(ip: string, token: string): Promise<void> {
    // Only rate-limit on failed attempts — we don't know if it failed yet.
    // Use a separate counter that we increment only on failure.
    // For simplicity, we count ALL attempts per IP here with a generous limit.
    const key     = `auth:rate:${ip}`;
    const allowed = await this.redis.incr(key);
    if (allowed === 1) {
      // Set expiry on first hit
      await this.redis.expire(key, 60);
    }
    if (allowed > 120) {  // 120 attempts per minute per IP
      this.logger.warn({
        event:       "auth_rate_limit_exceeded",
        ip,
        attempts:    allowed,
      });
      throw new TRPCError({
        code:    "TOO_MANY_REQUESTS",
        message: "Too many authentication attempts. Try again later.",
      });
    }
  }

  private _logAuthFailure(
    source: string,
    ip:     string | undefined,
    reason: string,
  ): void {
    this.logger.warn({
      event:  "auth_failure",
      source,
      ip:     ip ?? "unknown",
      reason,
    });
  }
}
