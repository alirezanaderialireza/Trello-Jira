// apps/web/middleware.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Edge-runtime safe route protection.
//
// We deliberately do NOT import from `@/auth` here. The full auth config
// pulls in the Drizzle adapter, the Argon2 hasher (a native @node-rs module),
// and the audit logger (which uses `node:crypto`). None of those work in
// the Edge runtime where Next.js middleware executes, and Turbopack
// bails the build out with "Module not found: @node-rs/argon2-wasm32-wasi"
// + "node:crypto is not supported in the Edge Runtime".
//
// Instead this middleware does a lightweight cookie check: if no Auth.js
// session cookie is present we redirect to /login with the requested URL
// preserved as `callbackUrl`. The actual session validation (and ACL
// enforcement) happens server-side on the protected page / API route via
// `getServerSession()`, which runs in Node and can talk to the database.
//
// This is the documented pattern for Auth.js v5 + database session
// strategy: middleware can only reach as far as the cookie because the
// Edge runtime cannot open a Postgres connection.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Auth.js v5 cookie names. The "__Secure-" prefix is used in production
// over HTTPS; the unprefixed variant is used in development.
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

export function middleware(req: NextRequest): NextResponse {
  const hasSession = SESSION_COOKIE_NAMES.some(
    (name) => Boolean(req.cookies.get(name)?.value),
  );

  if (hasSession) {
    return NextResponse.next();
  }

  // No session cookie → redirect to login, preserving the destination.
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|api/health|api/trpc|login|signup|forgot-password|reset-password|verify-email).*)"],
};
