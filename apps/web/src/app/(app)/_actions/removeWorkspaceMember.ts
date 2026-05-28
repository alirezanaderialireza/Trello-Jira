"use server";

// apps/web/src/app/(app)/_actions/removeWorkspaceMember.ts
//
// Backs the "حذف از فضای کاری" action on each member row. Calls
// v1.public.workspace.members.remove. The procedure enforces the
// last-owner invariant — removing the only OWNER is rejected
// server-side with a Persian error.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export interface RemoveWorkspaceMemberInput {
  workspaceId: string;
  userId: string;
}

export interface RemoveWorkspaceMemberResult {
  ok: boolean;
  error?: string;
}

export async function removeWorkspaceMemberAction(
  input: RemoveWorkspaceMemberInput,
): Promise<RemoveWorkspaceMemberResult> {
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) {
    return { ok: false, error: "شناسهٔ فضای کاری معتبر نیست." };
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return { ok: false, error: "شناسهٔ کاربر معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.workspace.members.remove({
      workspaceId: input.workspaceId,
      userId: input.userId,
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
  return "خطایی در حذف عضو رخ داد.";
}
