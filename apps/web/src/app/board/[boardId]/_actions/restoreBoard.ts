"use server";

// apps/web/src/app/board/[boardId]/_actions/restoreBoard.ts
//
// Stub for the post-soft-delete restore path. F5b's drawer flow
// shows the type-title-to-confirm delete inside the danger tab; once
// the soft-delete commits, the user is bounced off the board page,
// so the in-drawer "undo" path doesn't apply (unlike workspaces
// where the toast survives navigation). This action is shipped for
// future use by the workspaces-list archive panel and any
// follow-up restore-from-toast UX.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { persianMessage, type ActionResult } from "./_helpers";

export interface RestoreBoardInput {
  boardId: string;
}

export async function restoreBoardAction(
  input: RestoreBoardInput,
): Promise<ActionResult> {
  if (typeof input.boardId !== "string" || input.boardId.length === 0) {
    return { ok: false, error: "شناسهٔ بورد معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.boardManagement.restoreBoard({
      boardId: input.boardId,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath(`/board/${input.boardId}`);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: persianMessage(err, "خطا در بازیابی بورد.") };
  }
}
