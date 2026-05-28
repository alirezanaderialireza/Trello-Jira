// apps/web/src/auth/config.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Auth.js v5 configuration
//
// Stack:
//   • Drizzle adapter           — users/accounts persisted in Postgres.
//   • Credentials provider      — email + password, Argon2id verification.
//   • JWT session strategy      — required by Auth.js when using Credentials
//                                 provider. Session data lives in a signed
//                                 cookie; revocation requires a deny-list.
//
// Hardening that lives here:
//   1. IP-based rate limit on the Credentials `authorize()` callback. Auth.js
//      doesn't surface a per-IP limiter on its built-in /api/auth/callback
//      route, so we wedge one in at the start of authorize() — failed
//      attempts and successful attempts both consume from the same window.
//
//   2. Lifecycle audit. `events.signIn` / `events.signOut` / `events.createUser`
//      append rows to `audit_logs` so we have a forensic trail of every
//      sign-in, sign-out and account creation. This was the missing leg of
//      0.2 (the old auth.router.ts had it; once we moved to Auth.js the
//      hook went silent).
//
//   3. Email verification gating. `authorize()` returns `null` (which
//      Auth.js translates to a generic CredentialsSignin error) when the
//      account has no `emailVerifiedAt`. Without this check, signup-time
//      auto-verification could silently bypass the verify-email flow.
// ─────────────────────────────────────────────────────────────────────────────

import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db, users, accounts, authSessions, verificationTokens } from "@repo/db";
import { eq, and, isNull } from "drizzle-orm";
import { Argon2PasswordHasher } from "@repo/infrastructure/auth/argon2Hasher";
import { checkAuthRateLimit, SIGNIN_LIMIT } from "@repo/api/middleware/authRateLimit";
import { recordAuthEvent } from "./authAuditLogger";

const hasher = new Argon2PasswordHasher();

/** Best-effort IP extraction from a Web Request. */
function extractIp(req?: Request): string {
  if (!req) return "unknown";
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

function extractUa(req?: Request): string | null {
  return req?.headers.get("user-agent") ?? null;
}

export const authConfig: NextAuthConfig = {
  adapter: DrizzleAdapter(db as any, {
    usersTable: users as any,
    accountsTable: accounts as any,
    sessionsTable: authSessions as any,
    verificationTokensTable: verificationTokens as any,
  }),
  providers: [
    Credentials({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        // Auth.js v5 passes a Request as the second arg, used here for IP
        // extraction. In some test harnesses it can be undefined.
        const req = request as unknown as Request | undefined;
        const ip = extractIp(req);
        const userAgent = extractUa(req);

        // ── 1. Rate limit before doing any password work ──────────────────
        const rl = checkAuthRateLimit(ip, SIGNIN_LIMIT);
        if (!rl.allowed) {
          // We deliberately mirror the "invalid credentials" path so we
          // don't leak whether the email exists. The audit record carries
          // the rate-limit cause for ops debugging.
          await recordAuthEvent({
            userId: null,
            action: "auth.signInFailed",
            ip,
            userAgent,
            details: { reason: "rate_limited", retryAfterMs: rl.resetAt - Date.now() },
          });
          return null;
        }

        if (!credentials?.email || !credentials?.password) return null;
        const emailNorm = (credentials.email as string).toLowerCase().trim();

        const user = await (db as any)
          .select()
          .from(users)
          .where(and(eq(users.emailNormalized, emailNorm), isNull(users.deletedAt)))
          .limit(1)
          .then((r: any[]) => r[0] ?? null);

        // ── 2. Reject unknown / unverified / no-password accounts ─────────
        if (!user || !user.passwordHash || !user.emailVerifiedAt) {
          await recordAuthEvent({
            userId: user?.id ?? null,
            action: "auth.signInFailed",
            ip,
            userAgent,
            details: {
              reason: !user
                ? "unknown_email"
                : !user.passwordHash
                  ? "no_password_set"
                  : "email_not_verified",
            },
          });
          return null;
        }

        // ── 3. Verify password ────────────────────────────────────────────
        const valid = await hasher.verify(credentials.password as string, user.passwordHash);
        if (!valid) {
          await recordAuthEvent({
            userId: user.id,
            action: "auth.signInFailed",
            ip,
            userAgent,
            details: { reason: "bad_password" },
          });
          return null;
        }

        return { id: user.id, email: user.email, name: user.displayName };
      },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, `user` is the object returned from authorize().
      // Persist user.id into the JWT so it survives across requests.
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      // Populate session.user.id from the JWT subject claim.
      if (token?.sub) session.user.id = token.sub;
      return session;
    },
  },
  // ─── Lifecycle audit hooks ─────────────────────────────────────────────
  // These fire AFTER the main flow has succeeded. They run on the server
  // and are best-effort: a logging failure must never block the auth flow.
  events: {
    async signIn({ user }) {
      if (!user?.id) return;
      await recordAuthEvent({
        userId: user.id,
        action: "auth.signIn",
        details: { email: user.email ?? null },
      });
    },
    async signOut(message) {
      // Auth.js v5 passes either { session } (database strategy) or
      // { token } (JWT strategy). We use JWT strategy, so extract from token.
      const token = (message as { token?: { sub?: string } | null }).token;
      const userId = token?.sub ?? null;
      if (!userId) return;
      await recordAuthEvent({ userId, action: "auth.signOut" });
    },
    async createUser({ user }) {
      // Fires after the DrizzleAdapter inserts a new user via OAuth or
      // magic-link. Credentials signup goes through /api/auth/signup
      // (which already writes its own row), so this only catches the
      // adapter-driven flows.
      if (!user?.id) return;
      await recordAuthEvent({
        userId: user.id,
        action: "auth.signUp",
        details: { email: user.email ?? null, viaAdapter: true },
      });
    },
  },
};
