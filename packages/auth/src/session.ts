// packages/auth/src/session.ts
// Session extraction from HTTP requests and raw tokens.
// Maps JWT claims to the application Session type used by tRPC context.

import { verifyJwt, type JwtPayload } from "./jwt";
import { AUTH_COOKIE_NAME, AUTH_HEADER } from "./constants";

// ============================================================================
// Types — mirrors the Session type in packages/api/src/trpc.ts
// ============================================================================

export interface AuthSession {
  user: { id: string };
  tenantId: string;
  aclVersion: number;
  roles: string[];
}

// ============================================================================
// Extract session from HTTP Request (Next.js App Router / Edge)
// ============================================================================

/**
 * Extracts and verifies the session from an HTTP Request object.
 * Checks:
 *   1. Authorization: Bearer <token> header
 *   2. Cookie: trello_session=<token>
 *
 * Returns null if no valid session is found (never throws).
 */
export async function getSessionFromRequest(req: Request): Promise<AuthSession | null> {
  // 1. Try Authorization header first (used by WS handshake and API clients)
  const authHeader = req.headers.get(AUTH_HEADER);
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    return getSessionFromToken(token);
  }

  // 2. Try cookie (used by browser)
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    const token = parseCookieValue(cookieHeader, AUTH_COOKIE_NAME);
    if (token) {
      return getSessionFromToken(token);
    }
  }

  return null;
}

/**
 * Verifies a raw JWT token and returns the AuthSession.
 * Used by WS server for token validation.
 */
export async function getSessionFromToken(token: string): Promise<AuthSession | null> {
  const payload = await verifyJwt(token);
  if (!payload) return null;
  return mapPayloadToSession(payload);
}

// ============================================================================
// Internal helpers
// ============================================================================

function mapPayloadToSession(payload: JwtPayload): AuthSession {
  return {
    user: { id: payload.sub },
    tenantId: payload.tid,
    aclVersion: payload.acl,
    roles: payload.roles,
  };
}

function parseCookieValue(cookieHeader: string, name: string): string | null {
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));

  if (!match) return null;
  return match.slice(name.length + 1);
}
