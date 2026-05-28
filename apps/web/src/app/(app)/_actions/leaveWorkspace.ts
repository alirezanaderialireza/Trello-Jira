"use server";

// apps/web/src/app/(app)/_actions/leaveWorkspace.ts
//
// Backs the "خروج از فضای کاری" CTA in the Danger tab (visible to
// MEMBER + ADMIN users — the OWNER must transferOwnership first).
// Calls v1.public.workspace.members.leave. The procedure enforces
// the last-owner invariant: an OWNER trying to leave is rejected
// with a Persian error directing them to transfer ownership.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export interface LeaveWorkspaceInput {
  workspaceId: string;
}

export interface LeaveWorkspaceResult {
  ok: boolean;
  error?: string;
}

export async function leaveWorkspaceAction(
  input: LeaveWorkspaceInput,
): Promise<LeaveWorkspaceResult> {
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) {
    return { ok: false, error: "شناسهٔ فضای کاری معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.workspace.members.leave({
      workspaceId: input.workspaceId,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath("/", "layout");
    revalidatePath("/workspaces");
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
  return "خطایی در خروج از فضای کاری رخ داد.";
}
