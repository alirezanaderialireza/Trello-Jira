"use server";

// apps/web/src/app/board/[boardId]/_actions/updateBoardDescription.ts
//
// Backs the About tab's editable description block (F1.4.2). Calls
// v1.public.boardManagement.updateBoardMetadata with only `description`
// (the title form keeps using the legacy renameBoard action). An empty /
// whitespace-only value is normalised to null so the DB stores NULL rather
// than an empty string.

import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { persianMessage, type ActionResult } from "./_helpers";

export interface UpdateBoardDescriptionInput {
  boardId: string;
  description: string | null;
}

const DESCRIPTION_MAX = 5000;

export async function updateBoardDescriptionAction(
  input: UpdateBoardDescriptionInput,
): Promise<ActionResult> {
  if (typeof input.boardId !== "string" || input.boardId.length === 0) {
    return { ok: false, error: "شناسهٔ بورد معتبر نیست." };
  }

  // Normalise: trim, and treat empty as a clear (null).
  const trimmed = (input.description ?? "").trim();
  if (trimmed.length > DESCRIPTION_MAX) {
    return {
      ok: false,
      error: `توضیحات نباید از ${DESCRIPTION_MAX} کاراکتر بیشتر باشد.`,
    };
  }
  const normalized: string | null = trimmed.length === 0 ? null : trimmed;

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.boardManagement.updateBoardMetadata({
      boardId: input.boardId,
      description: normalized,
    });
    revalidatePath(`/board/${input.boardId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: persianMessage(err, "خطا در ذخیرهٔ توضیحات.") };
  }
}
