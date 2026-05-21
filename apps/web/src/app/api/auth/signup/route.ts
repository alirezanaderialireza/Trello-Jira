// apps/web/src/app/api/auth/signup/route.ts
// Custom signup endpoint — creates user + personal workspace.

import { db, users, workspaces, workspaceMembers } from "@repo/db";
import { eq, and, isNull } from "drizzle-orm";
import { Argon2PasswordHasher } from "@repo/infrastructure/auth/argon2Hasher";
import { NextResponse } from "next/server";

const hasher = new Argon2PasswordHasher();

export async function POST(req: Request) {
  try {
    const { email, displayName, password } = await req.json();

    if (!email || !displayName || !password) {
      return NextResponse.json({ message: "Missing required fields" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ message: "Password must be at least 8 characters" }, { status: 400 });
    }

    const emailNormalized = email.toLowerCase().trim();

    // Check if email already exists
    const existing = await (db as any)
      .select().from(users)
      .where(and(eq(users.emailNormalized, emailNormalized), isNull(users.deletedAt)))
      .limit(1).then((r: any[]) => r[0] ?? null);

    if (existing) {
      return NextResponse.json({ message: "این ایمیل قبلاً ثبت شده است" }, { status: 409 });
    }

    const passwordHash = await hasher.hash(password);
    const userId = crypto.randomUUID();
    const wsId = crypto.randomUUID();
    const now = new Date();

    // Create user
    await (db as any).insert(users).values({
      id: userId,
      email,
      emailNormalized,
      passwordHash,
      displayName: displayName.trim(),
      locale: "fa",
      timezone: "Asia/Tehran",
      emailVerifiedAt: now, // Auto-verify for MVP (magic-link would set this on click)
      createdAt: now,
      updatedAt: now,
    });

    // Create personal workspace
    const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || `ws-${userId.slice(0, 8)}`;
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

    // Add user as OWNER of personal workspace
    await (db as any).insert(workspaceMembers).values({
      workspaceId: wsId,
      userId,
      role: "OWNER",
      joinedAt: now,
    });

    return NextResponse.json({ success: true, userId }, { status: 201 });
  } catch (err: any) {
    console.error("[Signup] Error:", err);
    return NextResponse.json({ message: "Internal error" }, { status: 500 });
  }
}
