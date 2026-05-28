"use server";

// apps/web/src/app/(app)/_actions/softDeleteWorkspace.ts
//
// Backs the "حذف فضای کاری" button in the Danger tab. Calls
// v1.public.workspace.delete which sets `deleted_at = NOW()`
// (idempotent, OWNER-gated). The procedure also emits
// `workspace.soft_deleted` outbox event for audit + future email
// notification.
//
// The 30-day grace window for hard-delete lives in the domain use
// case; this action only triggers the soft-delete. The 10-second
// in-app "Undo" toast (D6) lives client-side: the toast renders a
// "بازگردانی" button that invokes restoreWorkspaceAction. That UX
// thread is independent of this action.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export interface SoftDeleteWorkspaceInput {
  workspaceId: string;
}

export interface SoftDeleteWorkspaceResult {
  ok: boolean;
  error?: string;
}

export async function softDeleteWorkspaceAction(
  input: SoftDeleteWorkspaceInput,
): Promise<SoftDeleteWorkspaceResult> {
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) {
    return { ok: false, error: "شناسهٔ فضای کاری معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.workspace.delete({
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
  return "خطایی در حذف فضای کاری رخ داد.";
}
