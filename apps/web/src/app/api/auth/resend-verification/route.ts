// apps/web/src/app/api/auth/resend-verification/route.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/resend-verification
// Body: { email: string }
//
// Re-issues an email verification token for an unverified account. Used when
// the original email was lost, expired, or never delivered.
//
// Security:
//   • Anti-enumeration: returns success regardless of whether the email
//     exists or whether it's already verified.
//   • Rate-limited (3/h/IP) to prevent abuse as a "spam this user" vector.
//   • Issuance helper deletes any prior verify token before inserting a
//     fresh one, so this endpoint is also idempotent.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db, users } from "@repo/db";
import { rateLimitResponse, MAGIC_LINK_LIMIT } from "@repo/api/middleware/authRateLimit";
import { issueAndSendVerificationToken } from "@/auth/emailVerification";

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

    // ── 3. Look up the user (do NOT leak existence) ──────────────────────
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

    // Re-issue only when the user exists AND isn't already verified.
    // Either branch returns the same shape so the API can't be used to
    // probe verification state.
    if (user && !user.emailVerifiedAt) {
      await issueAndSendVerificationToken({
        userEmail: user.email,
        emailNormalized,
        displayName: user.displayName,
        req,
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("[resend-verification] error", err);
    return NextResponse.json({ message: "Internal error" }, { status: 500 });
  }
}
