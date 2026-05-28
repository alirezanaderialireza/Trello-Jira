"use server";

// apps/web/src/app/board/[boardId]/_actions/renameBoard.ts
//
// Backs the About tab's title rename. Calls
// v1.public.boardManagement.renameBoard. Description is NOT included
// in F5b — the renameBoard procedure currently accepts only `title`
// (steering TODO: extend renameBoard or add a dedicated procedure
// when description editor lands in F1.2).

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
    await caller.v1.public.boardManagement.renameBoard({
      boardId: input.boardId,
      title: trimmed,
    });
    revalidatePath(`/board/${input.boardId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: persianMessage(err, "خطا در تغییر عنوان بورد.") };
  }
}
