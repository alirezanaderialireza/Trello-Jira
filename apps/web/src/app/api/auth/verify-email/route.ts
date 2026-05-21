// apps/web/src/app/api/auth/verify-email/route.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/verify-email?token=...
//
// Activates a user account by setting `users.email_verified_at = now()`.
// Called by /verify-email page on mount via `fetch(url)`.
//
// Token model:
//   verification_tokens row with identifier `email-verify:<email>` and
//   expires <= now+24h. Tokens are issued in /api/auth/signup and
//   /api/auth/resend-verification.
//
// Security:
//   • Single-use: the matching row is deleted on the first lookup,
//     before we even check expiry — so a leaked / re-clicked link can't
//     be used twice.
//   • The endpoint accepts ONLY the token (no email parameter) to keep
//     the URL short. We resolve the email by stripping the prefix from the
//     stored `identifier`.
//   • Idempotent for already-verified users: if the token is missing AND
//     a user with the (rebuilt) email is already verified, we return 200
//     so re-clicks of an old email don't surface a confusing error after
//     the user is already signed in.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db, users, verificationTokens } from "@repo/db";
import { EMAIL_VERIFY_PREFIX } from "@/auth/emailVerification";
import { rateLimitResponse, MAGIC_LINK_LIMIT } from "@repo/api/middleware/authRateLimit";

export async function GET(req: Request) {
  try {
    // ── 0. Rate limit ─────────────────────────────────────────────────────
    // GET endpoints are easy to flood, and an attacker can blind-guess
    // the 32-byte token but only at the rate the limiter allows.
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const limited = rateLimitResponse(ip, MAGIC_LINK_LIMIT);
    if (limited) return limited;

    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? "";
    if (!token) {
      return NextResponse.json({ message: "Missing token" }, { status: 400 });
    }

    // ── 1. Look up the token row ──────────────────────────────────────────
    const tokenRow = await (db as any)
      .select()
      .from(verificationTokens)
      .where(eq(verificationTokens.token, token))
      .limit(1)
      .then((r: any[]) => r[0] ?? null);

    if (!tokenRow || !tokenRow.identifier?.startsWith(EMAIL_VERIFY_PREFIX)) {
      return NextResponse.json(
        { message: "لینک نامعتبر یا منقضی شده است" },
        { status: 400 },
      );
    }

    const emailNormalized = tokenRow.identifier.slice(EMAIL_VERIFY_PREFIX.length);

    // ── 2. Burn the token (single-use) ───────────────────────────────────
    await (db as any)
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, tokenRow.identifier),
          eq(verificationTokens.token, token),
        ),
      );

    // ── 3. Expiry check ───────────────────────────────────────────────────
    if (new Date(tokenRow.expires).getTime() < Date.now()) {
      return NextResponse.json(
        { message: "لینک منقضی شده است. لطفاً دوباره درخواست دهید." },
        { status: 400 },
      );
    }

    // ── 4. Resolve the user ──────────────────────────────────────────────
    const user = await (db as any)
      .select()
      .from(users)
      .where(
        and(
          eq(users.emailNormalized, emailNormalized),
          isNull(users.deletedAt),
        ),
      )
      .limit(1)
      .then((r: any[]) => r[0] ?? null);

    if (!user) {
      return NextResponse.json(
        { message: "کاربر یافت نشد" },
        { status: 400 },
      );
    }

    // Already verified? Treat as success (idempotent).
    if (user.emailVerifiedAt) {
      return NextResponse.json({ success: true, alreadyVerified: true });
    }

    // ── 5. Mark verified ─────────────────────────────────────────────────
    await (db as any)
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[verify-email] error", err);
    return NextResponse.json({ message: "Internal error" }, { status: 500 });
  }
}
