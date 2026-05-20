// packages/auth/src/jwt.ts
// Lightweight JWT sign/verify using Web Crypto API (HMAC-SHA256).
// Zero external dependencies — works in Node.js 18+, Edge Runtime, and browsers.

import { getJwtSecret, TOKEN_EXPIRY_SECONDS } from "./constants";

// ============================================================================
// Types
// ============================================================================

export interface JwtPayload {
  /** User ID (sub claim). */
  sub: string;
  /** Tenant/workspace ID. */
  tid: string;
  /** User roles. */
  roles: string[];
  /** ACL version at time of issuance. */
  acl: number;
  /** Issued at (unix seconds). */
  iat: number;
  /** Expires at (unix seconds). */
  exp: number;
}

// ============================================================================
// Encoding helpers
// ============================================================================

function base64UrlEncode(data: Uint8Array): string {
  const str = btoa(String.fromCharCode(...data));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(str: string): string {
  return base64UrlEncode(new TextEncoder().encode(str));
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// ============================================================================
// HMAC-SHA256 signing
// ============================================================================

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );

  return base64UrlEncode(new Uint8Array(signature));
}

async function hmacVerify(data: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(data, secret);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Signs a JWT with HMAC-SHA256.
 * Returns the compact token string (header.payload.signature).
 */
export async function signJwt(payload: Omit<JwtPayload, "iat" | "exp">): Promise<string> {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);

  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  };

  const header = base64UrlEncodeString(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncodeString(JSON.stringify(fullPayload));
  const signingInput = `${header}.${body}`;
  const signature = await hmacSign(signingInput, secret);

  return `${signingInput}.${signature}`;
}

/**
 * Verifies a JWT token. Returns the payload if valid, null if invalid/expired.
 * Never throws — safe to use in middleware.
 */
export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  try {
    const secret = getJwtSecret();
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const signingInput = `${header}.${body}`;

    // Verify signature
    const valid = await hmacVerify(signingInput, signature!, secret);
    if (!valid) return null;

    // Decode payload
    const payloadBytes = base64UrlDecode(body!);
    const payload: JwtPayload = JSON.parse(new TextDecoder().decode(payloadBytes));

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}
