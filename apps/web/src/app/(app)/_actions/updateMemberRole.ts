"use server";

// apps/web/src/app/(app)/_actions/updateMemberRole.ts
//
// Backs the role-select dropdown on each member row. Calls
// v1.public.workspace.members.updateRole. Note that OWNER is NOT
// in the AssignableRoleSchema — to make someone OWNER, the current
// owner must use `transferOwnership` (different action, OWNER-gated).
// This action only flips between ADMIN and MEMBER.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export type AssignableRole = "ADMIN" | "MEMBER";

export interface UpdateMemberRoleInput {
  workspaceId: string;
  userId: string;
  role: AssignableRole;
}

export interface UpdateMemberRoleResult {
  ok: boolean;
  error?: string;
}

export async function updateMemberRoleAction(
  input: UpdateMemberRoleInput,
): Promise<UpdateMemberRoleResult> {
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) {
    return { ok: false, error: "شناسهٔ فضای کاری معتبر نیست." };
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return { ok: false, error: "شناسهٔ کاربر معتبر نیست." };
  }
  if (input.role !== "ADMIN" && input.role !== "MEMBER") {
    return { ok: false, error: "نقش انتخابی معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.workspace.members.updateRole({
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: persianMessage(err) };
  }
}

function persianMessage(err: unknown): string {
  const message = (err as { message?: unknown })?.message;
  if (typeof message === "string" && message.length > 0 && message.length < 200) {
    return message;
  }
  return "خطایی در تغییر نقش رخ داد.";
}
