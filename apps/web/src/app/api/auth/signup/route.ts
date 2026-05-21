// apps/web/src/app/api/auth/signup/route.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/signup
// Body: { email, displayName, password }
//
// Creates a user account and a personal workspace, then issues an email
// verification token (delivered via @repo/infrastructure/email).
//
// Important behaviour change vs. the prior MVP:
//   • Previously this endpoint set `email_verified_at = now()` immediately,
//     auto-verifying every signup. That was a stand-in until the email flow
//     existed.
//   • Now `email_verified_at` is left NULL at signup. The user must click
//     the link in the verification email before Auth.js will let them sign
//     in (the credentials provider in auth/config.ts requires
//     `emailVerifiedAt`).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db, users, workspaces, workspaceMembers } from "@repo/db";
import { Argon2PasswordHasher } from "@repo/infrastructure/auth/argon2Hasher";
import { rateLimitResponse, SIGNUP_LIMIT } from "@repo/api/middleware/authRateLimit";
import { issueAndSendVerificationToken } from "@/auth/emailVerification";

const hasher = new Argon2PasswordHasher();

export async function POST(req: Request) {
  try {
    // ── 1. Rate limit ─────────────────────────────────────────────────────
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const limited = rateLimitResponse(ip, SIGNUP_LIMIT);
    if (limited) return limited;

    // ── 2. Parse + validate input ─────────────────────────────────────────
    const { email, displayName, password } = await req.json();
    if (!email || !displayName || !password) {
      return NextResponse.json({ message: "Missing required fields" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json(
        { message: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }

    const emailNormalized = email.toLowerCase().trim();

    // ── 3. Reject duplicates ──────────────────────────────────────────────
    const existing = await (db as any)
      .select()
      .from(users)
      .where(and(eq(users.emailNormalized, emailNormalized), isNull(users.deletedAt)))
      .limit(1)
      .then((r: any[]) => r[0] ?? null);

    if (existing) {
      return NextResponse.json(
        { message: "این ایمیل قبلاً ثبت شده است" },
        { status: 409 },
      );
    }

    // ── 4. Persist the new user (NOT yet verified) ────────────────────────
    const passwordHash = await hasher.hash(password);
    const userId = crypto.randomUUID();
    const wsId = crypto.randomUUID();
    const now = new Date();

    await (db as any).insert(users).values({
      id: userId,
      email,
      emailNormalized,
      passwordHash,
      displayName: displayName.trim(),
      locale: "fa",
      timezone: "Asia/Tehran",
      // emailVerifiedAt intentionally NULL — set when the user clicks the
      // verification link.
      createdAt: now,
      updatedAt: now,
    });

    // ── 5. Personal workspace + ownership ─────────────────────────────────
    const slug =
      displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50) || `ws-${userId.slice(0, 8)}`;

    await (db as any).insert(workspaces).values({
      id: wsId,
      name: `${displayName}'s Workspace`,
      slug: slug.length >= 2 ? slug : `ws-${userId.slice(0, 8)}`,
      tier: "free",
      ownerId: userId,
      personalForUserId: userId,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });

    await (db as any).insert(workspaceMembers).values({
      workspaceId: wsId,
      userId,
      role: "OWNER",
      joinedAt: now,
    });

    // ── 6. Issue email-verification token + send the email ────────────────
    await issueAndSendVerificationToken({
      userEmail: email,
      emailNormalized,
      displayName: displayName.trim(),
      req,
    });

    return NextResponse.json(
      {
        success: true,
        userId,
        // The frontend uses this flag to show "check your inbox" UX.
        verificationRequired: true,
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error("[signup] Error:", err);
    return NextResponse.json({ message: "Internal error" }, { status: 500 });
  }
}
