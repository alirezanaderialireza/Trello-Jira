"use server";

// apps/web/src/app/board/[boardId]/_actions/archiveBoard.ts
//
// Backs the "بایگانی بورد" button in the Danger tab. Calls
// v1.public.boardManagement.archiveBoard which sets archivedAt =
// NOW() (idempotent, ADMIN+OWNER gated, OWNER-only re-archive
// rejected by the F2 lifecycle assertion).
//
// The 10-second "بازگردانی" grace toast (D4) is the parent
// component's responsibility — this action just commits the
// archive. The toast invokes unarchiveBoardAction via its action
// callback.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { persianMessage, type ActionResult } from "./_helpers";

export interface ArchiveBoardInput {
  boardId: string;
}

export async function archiveBoardAction(
  input: ArchiveBoardInput,
): Promise<ActionResult> {
  if (typeof input.boardId !== "string" || input.boardId.length === 0) {
    return { ok: false, error: "شناسهٔ بورد معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.boardManagement.archiveBoard({
      boardId: input.boardId,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath(`/board/${input.boardId}`);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: persianMessage(err, "خطا در بایگانی بورد.") };
  }
}
