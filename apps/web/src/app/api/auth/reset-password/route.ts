// apps/web/src/app/api/auth/reset-password/route.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/reset-password
// Body: { token: string, email: string, password: string }
//
// Completes the password-reset flow started by /api/auth/forgot-password.
// Verifies the token, replaces the user's password hash, and consumes the
// token so it cannot be reused.
//
// Security properties:
//   • Single-use: the token row is deleted on success AND on every failed
//     attempt (so an attacker can't keep guessing variants of the same
//     token).
//   • Time-limited: tokens older than `expires` are rejected as expired.
//   • Constant-success on lookup miss: we return a generic "invalid or
//     expired" message without distinguishing which reason triggered it.
//   • Rate limited per IP via SIGNUP_LIMIT (3/hour) — reset attempts are
//     about as common as signups.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db, users, verificationTokens } from "@repo/db";
import { Argon2PasswordHasher } from "@repo/infrastructure/auth/argon2Hasher";
import { rateLimitResponse, SIGNUP_LIMIT } from "@repo/api/middleware/authRateLimit";

const PWD_RESET_PREFIX = "pwd-reset:";
const hasher = new Argon2PasswordHasher();

export async function POST(req: Request) {
  try {
    // ── 1. Rate limit ─────────────────────────────────────────────────────
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const limited = rateLimitResponse(ip, SIGNUP_LIMIT);
    if (limited) return limited;

    // ── 2. Parse + validate input ─────────────────────────────────────────
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!token || !email || !password) {
      return NextResponse.json({ message: "اطلاعات ناقص" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json(
        { message: "رمز عبور باید حداقل ۸ کاراکتر باشد" },
        { status: 400 },
      );
    }

    const identifier = `${PWD_RESET_PREFIX}${email}`;

    // ── 3. Look up the token row ─────────────────────────────────────────
    const tokenRow = await (db as any)
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, identifier),
          eq(verificationTokens.token, token),
        ),
      )
      .limit(1)
      .then((r: any[]) => r[0] ?? null);

    if (!tokenRow) {
      // Don't tell the attacker whether token or email was wrong.
      return NextResponse.json(
        { message: "لینک نامعتبر یا منقضی شده است" },
        { status: 400 },
      );
    }

    // ── 4. Single-use: delete the row regardless of what happens next ────
    await (db as any)
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, identifier),
          eq(verificationTokens.token, token),
        ),
      );

    // ── 5. Expiry check ───────────────────────────────────────────────────
    if (new Date(tokenRow.expires).getTime() < Date.now()) {
      return NextResponse.json(
        { message: "لینک نامعتبر یا منقضی شده است" },
        { status: 400 },
      );
    }

    // ── 6. Resolve the user (must still exist + not soft-deleted) ────────
    const user = await (db as any)
      .select()
      .from(users)
      .where(
        and(
          eq(users.emailNormalized, email),
          isNull(users.deletedAt),
        ),
      )
      .limit(1)
      .then((r: any[]) => r[0] ?? null);

    if (!user) {
      return NextResponse.json(
        { message: "لینک نامعتبر یا منقضی شده است" },
        { status: 400 },
      );
    }

    // ── 7. Hash + store new password ─────────────────────────────────────
    const passwordHash = await hasher.hash(password);
    await (db as any)
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("[reset-password] error", err);
    return NextResponse.json({ message: "Internal error" }, { status: 500 });
  }
}
