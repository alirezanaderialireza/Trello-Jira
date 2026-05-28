"use server";

// apps/web/src/app/(app)/_actions/restoreWorkspace.ts
//
// Backs the 10-second "بازگردانی" undo toast invoked right after
// softDeleteWorkspace, and the (future) restore-from-archive UI in
// the workspaces list. Calls v1.public.workspace.restore which:
//   • Verifies the workspace is still within the 30-day grace
//     window (rejected with Persian error otherwise — the toast
//     was meant for the in-window case but the procedure double-
//     checks)
//   • Clears `deleted_at`
//   • Emits `workspace.restored` outbox event

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export interface RestoreWorkspaceInput {
  workspaceId: string;
}

export interface RestoreWorkspaceResult {
  ok: boolean;
  error?: string;
}

export async function restoreWorkspaceAction(
  input: RestoreWorkspaceInput,
): Promise<RestoreWorkspaceResult> {
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) {
    return { ok: false, error: "شناسهٔ فضای کاری معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.workspace.restore({
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
  return "خطایی در بازگردانی فضای کاری رخ داد.";
}
