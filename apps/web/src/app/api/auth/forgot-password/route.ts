// apps/web/src/app/api/auth/forgot-password/route.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/forgot-password
// Body: { email: string }
//
// Issues a single-use, time-limited password-reset link and emails it to the
// user. Always returns 200 (success: true) regardless of whether the email
// exists, so the endpoint cannot be used for account enumeration.
//
// Token model:
//   We reuse the Auth.js `verification_tokens` table for both magic links and
//   password resets. To distinguish the two flows we namespace the
//   `identifier` column with `pwd-reset:<email>`.
//
// Security:
//   • Rate limited (3 / hour / IP) via the existing MAGIC_LINK_LIMIT.
//   • The token itself is 32 random bytes encoded as base64url — unguessable.
//   • Tokens expire 1 hour after issuance.
//   • Old tokens for the same identifier are invalidated when a new one is
//     issued, so a user who clicks "Resend" can rely on the latest link only.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db, users, verificationTokens } from "@repo/db";
import { createEmailSender, passwordResetEmailHtml } from "@repo/infrastructure/email";
import { rateLimitResponse, MAGIC_LINK_LIMIT } from "@repo/api/middleware/authRateLimit";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const PWD_RESET_PREFIX = "pwd-reset:";

const emailSender = createEmailSender();

export async function POST(req: Request) {
  try {
    // ── 1. Rate limit ─────────────────────────────────────────────────────
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const limited = rateLimitResponse(ip, MAGIC_LINK_LIMIT);
    if (limited) return limited;

    // ── 2. Parse + validate input ─────────────────────────────────────────
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!email || !email.includes("@")) {
      return NextResponse.json({ message: "ایمیل نامعتبر است" }, { status: 400 });
    }
    const emailNormalized = email.toLowerCase();

    // ── 3. Look up the user (do NOT leak existence) ───────────────────────
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

    // We always return success below; the rest of this block runs only when
    // the user actually exists. Timing is not a concern here because we
    // do not perform a password verification.
    if (user) {
      // 3a. Invalidate any prior reset tokens for this user.
      await (db as any)
        .delete(verificationTokens)
        .where(eq(verificationTokens.identifier, `${PWD_RESET_PREFIX}${emailNormalized}`));

      // 3b. Issue a fresh token and persist it.
      const token = randomBytes(32).toString("base64url");
      const expires = new Date(Date.now() + TOKEN_TTL_MS);

      await (db as any).insert(verificationTokens).values({
        identifier: `${PWD_RESET_PREFIX}${emailNormalized}`,
        token,
        expires,
      });

      // 3c. Send the email (best-effort; we still return success on failure).
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.NEXTAUTH_URL ||
        new URL(req.url).origin;
      const url = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(emailNormalized)}`;
      const html = passwordResetEmailHtml(url, user.displayName);

      try {
        await emailSender.send({
          to: user.email,
          subject: "بازنشانی رمز عبور Trello OS",
          html,
          text: `برای بازنشانی رمز عبور به این لینک بروید:\n${url}\n(تا ۱ ساعت معتبر است)`,
        });
      } catch (err) {
        console.error("[forgot-password] email dispatch failed", err);
      }
    }

    // ── 4. Uniform response — never reveal whether the email exists ───────
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("[forgot-password] error", err);
    return NextResponse.json({ message: "Internal error" }, { status: 500 });
  }
}
