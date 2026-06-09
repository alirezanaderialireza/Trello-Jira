"use server";

// apps/web/src/app/board/[boardId]/_actions/renameBoard.ts
//
// Backs the About tab's title rename. Calls
// v1.public.boardManagement.updateBoardMetadata (title only) so the rename
// emits a board.renamed outbox event (realtime + activity feed). The legacy
// renameBoard procedure (no outbox) is deprecated.

import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { persianMessage, type ActionResult } from "./_helpers";

export interface RenameBoardInput {
  boardId: string;
  title: string;
}

const TITLE_MAX = 128;

export async function renameBoardAction(
  input: RenameBoardInput,
): Promise<ActionResult> {
  if (typeof input.boardId !== "string" || input.boardId.length === 0) {
    return { ok: false, error: "شناسهٔ بورد معتبر نیست." };
  }
  const trimmed = (input.title ?? "").trim();
  if (trimmed.length === 0) return { ok: false, error: "عنوان بورد الزامی است." };
  if (trimmed.length > TITLE_MAX) {
    return { ok: false, error: `عنوان بورد نباید از ${TITLE_MAX} کاراکتر بیشتر باشد.` };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.boardManagement.updateBoardMetadata({
      boardId: input.boardId,
      title: trimmed,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath(`/board/${input.boardId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: persianMessage(err, "خطا در تغییر عنوان بورد.") };
  }
}
