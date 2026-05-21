// packages/api/src/routers/auth.router.ts
//
// ============================================================================
// 🔐 Auth Router — Login / Refresh / Logout / Validate / Token Rotation
// ============================================================================
//
// Endpoints:
//
//   auth.login          — Exchange credentials for access + refresh tokens.
//                         Creates a new session row in DB.
//
//   auth.refresh        — Rotate refresh token.  Issues new access + refresh
//                         tokens, revokes old access JTI.
//                         MUST use httpOnly cookie or secure header for refresh
//                         token in production.
//
//   auth.logout         — Revoke the current session.  Adds access JTI to
//                         revocation list.  Deletes refresh token from DB.
//
//   auth.validate       — Lightweight token validity check.  Returns current
//                         session claims.  Used by edge middleware / WS gateway.
//
//   auth.revokeSession  — Admin: forcibly revoke a specific session by ID.
//
// Security notes:
//   • Refresh tokens MUST be transmitted over httpOnly cookies in production.
//     This router accepts them in the request body for API-client convenience
//     but the transport should be reviewed before production deployment.
//   • Password hashing is NOT implemented here — the `usersDb` dependency
//     represents an external user service / auth provider (e.g. Clerk, Auth0,
//     or a custom bcrypt implementation).
//   • This router is PUBLIC (uses `publicProcedure` for login/refresh) and
//     PROTECTED (uses `protectedProcedure` for logout/validate).
//
// ============================================================================

import { z }           from "zod";
import { TRPCError }   from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../trpc";

// ============================================================================
// Schemas
// ============================================================================

const CredentialsSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8).max(256),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(32).max(512),
  sessionId:    z.string().uuid(),
});

// ============================================================================
// Router
// ============================================================================

export const authRouter = router({

  // ==========================================================================
  // 🔑 login
  // ==========================================================================
  login: publicProcedure
    .input(CredentialsSchema)
    .mutation(async ({ input, ctx }) => {
      const correlationId = ctx.metadata.requestId;
      const ip            = ctx.metadata.ip;
      const userAgent     = ctx.metadata.userAgent;

      // ── 1. Rate limit by IP ─────────────────────────────────────────────
      const allowed = await ctx.infra.rateLimiter.consume({
        key:      `auth:login:${ip ?? "unknown"}`,
        windowMs: 60_000,
        max:      10,
      });
      if (!allowed) {
        throw new TRPCError({
          code:    "TOO_MANY_REQUESTS",
          message: "Too many login attempts. Please wait.",
        });
      }

      // ── 2. Verify credentials (delegates to auth service / user repo) ────
      // In production: hash password with bcrypt, compare against DB
      // Here we call the injected userAuth service stub
      const userRow = await ctx.services.auth
        .verifyCredentials(input.email, input.password)
        .catch(() => null);

      if (!userRow) {
        // Log failed attempt for anomaly detection
        await ctx.services.auditLogger.logAuthEvent({
          actorId:       input.email,
          tenantId:      "unknown",
          action:        "auth.failed",
          correlationId,
          ip,
          userAgent,
          details:       { reason: "bad_credentials" },
        });
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials." });
      }

      // ── 3. Load memberships for initial claims ───────────────────────────
      const membershipMap = await ctx.services.membershipCache
        .getByUser(userRow.tenantId, userRow.id)
        .catch(() => null);

      const roles      = membershipMap?.roles      ?? [];
      const aclVersion = membershipMap?.aclVersion ?? 1;

      // ── 4. Issue tokens ──────────────────────────────────────────────────
      // Session row created by auth service alongside token issuance
      const { session, tokens } = await ctx.services.auth
        .createSession({
          userId:    userRow.id,
          tenantId:  userRow.tenantId,
          roles,
          aclVersion,
          ip,
          userAgent,
          correlationId,
        });

      // ── 5. Audit ─────────────────────────────────────────────────────────
      await ctx.services.auditLogger.logAuthEvent({
        actorId:       userRow.id,
        tenantId:      userRow.tenantId,
        action:        "auth.login",
        correlationId,
        ip,
        userAgent,
        details:       { sessionId: session.id },
      });

      return {
        accessToken:           tokens.accessToken,
        refreshToken:          tokens.refreshToken,
        accessTokenExpiresAt:  tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        sessionId:             session.id,
        userId:                userRow.id,
        tenantId:              userRow.tenantId,
        roles,
        aclVersion,
      };
    }),

  // ==========================================================================
  // 🔄 refresh
  // ==========================================================================
  refresh: publicProcedure
    .input(RefreshSchema)
    .mutation(async ({ input, ctx }) => {
      const correlationId = ctx.metadata.requestId;
      const ip            = ctx.metadata.ip;
      const userAgent     = ctx.metadata.userAgent;

      const result = await ctx.services.auth
        .rotateSession({
          sessionId:    input.sessionId,
          refreshToken: input.refreshToken,
          correlationId,
          ip,
          userAgent,
        })
        .catch((err: any) => {
          throw new TRPCError({
            code:    "UNAUTHORIZED",
            message: err?.message ?? "Token refresh failed.",
          });
        });

      await ctx.services.auditLogger.logAuthEvent({
        actorId:       result.session.userId,
        tenantId:      result.session.tenantId,
        action:        "auth.tokenRefreshed",
        correlationId,
        ip,
        userAgent,
        details:       { sessionId: input.sessionId },
      });

      return {
        accessToken:           result.tokens.accessToken,
        refreshToken:          result.tokens.refreshToken,
        accessTokenExpiresAt:  result.tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: result.tokens.refreshTokenExpiresAt,
        sessionId:             input.sessionId,
      };
    }),

  // ==========================================================================
  // 🚪 logout
  // ==========================================================================
  logout: protectedProcedure
    .input(z.object({
      /** Optional: revoke a specific session ID (admin use case) */
      sessionId: z.string().uuid().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const correlationId = ctx.metadata.requestId;
      const targetSessionId = input.sessionId ?? ctx.session.sid;

      await ctx.services.auth.revokeSession({
        sessionId:    targetSessionId,
        accessJti:    ctx.session.jti,
        accessExp:    ctx.session.exp,
        correlationId,
      });

      await ctx.services.auditLogger.logAuthEvent({
        actorId:       ctx.session.user.id,
        tenantId:      ctx.session.tenantId,
        action:        "auth.logout",
        correlationId,
        ip:            ctx.metadata.ip,
        userAgent:     ctx.metadata.userAgent,
        details:       { sessionId: targetSessionId },
      });

      return { success: true };
    }),

  // ==========================================================================
  // ✅ validate
  // ==========================================================================
  validate: protectedProcedure
    .query(({ ctx }) => {
      // If we reach here, the token is valid (protectedProcedure enforces it)
      return {
        userId:     ctx.session.user.id,
        tenantId:   ctx.session.tenantId,
        sessionId:  ctx.session.sid,
        roles:      ctx.session.roles,
        aclVersion: ctx.session.aclVersion,
        expiresAt:  ctx.session.exp,
      };
    }),

  // ==========================================================================
  // 🔑 publicKey — expose JWK for edge/WS verification
  // ==========================================================================
  publicKey: publicProcedure
    .query(async ({ ctx }) => {
      const jwk = await ctx.services.auth.getPublicKeyJwk();
      return { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", use: "sig" };
    }),
});
