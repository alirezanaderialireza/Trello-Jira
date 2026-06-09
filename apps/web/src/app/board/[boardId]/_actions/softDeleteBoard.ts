"use server";

// apps/web/src/app/board/[boardId]/_actions/softDeleteBoard.ts
//
// Backs the type-title-to-confirm soft-delete dialog in the Danger
// tab (visible only after archive — UX flow: archive first, then
// delete). Calls v1.public.boardManagement.softDeleteBoard which:
//   • Enforces OWNER role inline (ADMIN cannot delete)
//   • Sets boards.deletedAt = NOW()
//   • Emits board.soft_deleted outbox event

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { persianMessage, type ActionResult } from "./_helpers";

export interface SoftDeleteBoardInput {
  boardId: string;
}

export async function softDeleteBoardAction(
  input: SoftDeleteBoardInput,
): Promise<ActionResult> {
  if (typeof input.boardId !== "string" || input.boardId.length === 0) {
    return { ok: false, error: "شناسهٔ بورد معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.boardManagement.softDeleteBoard({
      boardId: input.boardId,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: persianMessage(err, "خطا در حذف بورد.") };
  }
}
