"use server";

// apps/web/src/app/board/[boardId]/_actions/updateVisibility.ts
//
// Backs the PermissionsTab visibility radio. Calls
// v1.public.boardManagement.updateVisibility. Three values:
//   • "workspace" — visible to every workspace member
//   • "private"   — only board members
//   • "public"    — anyone with the link (future use)

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { persianMessage, type ActionResult } from "./_helpers";

export type BoardVisibility = "workspace" | "private" | "public";

export interface UpdateBoardVisibilityInput {
  boardId: string;
  visibility: BoardVisibility;
}

export async function updateBoardVisibilityAction(
  input: UpdateBoardVisibilityInput,
): Promise<ActionResult> {
  if (typeof input.boardId !== "string" || input.boardId.length === 0) {
    return { ok: false, error: "شناسهٔ بورد معتبر نیست." };
  }
  if (
    input.visibility !== "workspace" &&
    input.visibility !== "private" &&
    input.visibility !== "public"
  ) {
    return { ok: false, error: "گزینهٔ دیده‌شدن معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.boardManagement.updateVisibility({
      boardId: input.boardId,
      visibility: input.visibility,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath(`/board/${input.boardId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: persianMessage(err, "خطا در تغییر دیده‌شدن.") };
  }
}
