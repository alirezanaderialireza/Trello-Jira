// packages/auth/src/constants.ts

/** Cookie name for the session JWT token. */
export const AUTH_COOKIE_NAME = "trello_session";

/** HTTP header name for Bearer token (WS and API). */
export const AUTH_HEADER = "authorization";

/** Token expiry: 7 days in milliseconds. */
export const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Token expiry in seconds (for JWT `exp` claim). */
export const TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

/** Secret key for JWT signing — must be set in production. */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("❌ FATAL: JWT_SECRET environment variable is required in production.");
    }
    // Dev fallback — NOT secure, only for local development
    return "dev-jwt-secret-DO-NOT-USE-IN-PRODUCTION";
  }
  return secret;
}
