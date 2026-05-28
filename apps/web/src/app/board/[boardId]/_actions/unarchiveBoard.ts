"use server";

// apps/web/src/app/board/[boardId]/_actions/unarchiveBoard.ts
//
// Backs the "بازگردانی" CTA in the danger banner (when archivedAt
// is set) AND the action button on the post-archive grace toast.
// Calls v1.public.boardManagement.unarchiveBoard which uses the
// {allowArchived: true} variant of the F2 admin write builder so
// the lifecycle assertion accepts an archived row as input.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { persianMessage, type ActionResult } from "./_helpers";

export interface UnarchiveBoardInput {
  boardId: string;
}

export async function unarchiveBoardAction(
  input: UnarchiveBoardInput,
): Promise<ActionResult> {
  if (typeof input.boardId !== "string" || input.boardId.length === 0) {
    return { ok: false, error: "شناسهٔ بورد معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.boardManagement.unarchiveBoard({
      boardId: input.boardId,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath(`/board/${input.boardId}`);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: persianMessage(err, "خطا در بازگردانی بورد.") };
  }
}
