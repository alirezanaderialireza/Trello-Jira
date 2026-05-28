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
// Instead this middleware does lightweight cookie + header checks. The
// actual session validation (with DB lookup of the user, the workspace,
// the role) happens in Server Components via `getWebSession()`, which
// runs in Node and can talk to the database.
//
// F4 extends the pre-existing logged-out → /login redirect with three
// new redirect rules. None of them touches the database.
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

// Auth pages that an unauthenticated user is allowed to reach.
//
// Keep this list in sync with the matcher regex below. Anything in
// (app)/* is protected; everything in (auth)/* is public-but-redirected
// when a session cookie is present.
const AUTH_PAGES = new Set<string>([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);

// Public path PREFIXES — pages reachable without a session AND
// reachable while logged in (no auto-redirect either way). Distinct
// from AUTH_PAGES because auth pages bounce signed-in users away,
// whereas these pages must remain accessible to all audiences.
//
//   /invitations/[token] — F5a invitation accept flow. A logged-out
//   user clicks the link in their email; if no session, they see
//   the invitation summary + a CTA pointing at /login. If they are
//   already signed in (with any account), the page renders an
//   accept button — possibly with a "wrong email" recovery path.
const PUBLIC_PAGE_PREFIXES = ["/invitations/"];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some(
    (name) => Boolean(req.cookies.get(name)?.value),
  );
}

function isAuthPage(pathname: string): boolean {
  // Exact-match against AUTH_PAGES is enough — none of them have nested
  // sub-routes that should also be public.
  return AUTH_PAGES.has(pathname);
}

function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  const hasSession = hasSessionCookie(req);

  // ── Rule 1: logged-in user requesting an auth page → bounce to /workspaces ─
  //
  // Without this, a signed-in user clicking "Login" from a stray bookmark
  // would land on the login form and be confused. The destination after
  // a successful login (per the existing flow) is /workspaces, so we
  // reuse the same target here.
  //
  // We do NOT redirect /verify-email because a user with a valid session
  // but no `email_verified_at` may legitimately need to revisit that
  // page to resend the verification email. The downstream verify-email
  // page will redirect them onward when verification is complete.
  if (hasSession && isAuthPage(pathname) && pathname !== "/verify-email") {
    return NextResponse.redirect(new URL("/workspaces", req.url));
  }

  // ── Rule 2: anonymous user requesting a protected route → /login ──────────
  //
  // Pages under PUBLIC_PAGE_PREFIXES (e.g. /invitations/[token]) are
  // skipped — they render their own auth-aware UI.
  if (!hasSession && !isAuthPage(pathname) && !isPublicPage(pathname)) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  // ── Default: pass through ─────────────────────────────────────────────────
  //
  // For everything else (logged-in user on a protected page, anonymous
  // user on an auth page) the middleware does nothing. The `getWebSession`
  // call inside Server Components handles fine-grained authorization
  // (membership, role, deleted-workspace 404) since those checks need
  // the database.
  //
  // Note: rule 3 from the F4 plan (email-not-verified guard) is also
  // deferred to Server Component land. Adding it here would require
  // either reading a "is_verified" cookie (we don't set one) or hitting
  // the database (forbidden in Edge runtime). The auth flow already
  // gates protected resources via `getWebSession` which throws on
  // unverified users; this middleware just ensures the user has *some*
  // session cookie before we even attempt that DB check.
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match everything except:
    //   • Next.js internals (_next/static, _next/image, favicon)
    //   • API routes (auth callbacks, health, tRPC, errors)
    //
    // Auth pages (login/signup/…) ARE in scope so rule 1 above can
    // redirect signed-in users away from them.
    "/((?!_next/static|_next/image|favicon.ico|api/auth|api/health|api/trpc|api/errors).*)",
  ],
};
