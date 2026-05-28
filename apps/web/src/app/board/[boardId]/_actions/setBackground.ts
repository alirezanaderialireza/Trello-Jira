"use server";

// apps/web/src/app/board/[boardId]/_actions/setBackground.ts
//
// Backs the BackgroundTab swatch click. Calls
// v1.public.boardManagement.setBackground with the token-based
// JSONB shape (D2): { type, id }. The procedure stores the value
// verbatim — any JSON object passes the DB CHECK.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { persianMessage, type ActionResult } from "./_helpers";

export interface SetBackgroundInput {
  boardId: string;
  /** Token-based shape `{ type, id }`. Pass `null` to clear the background
   *  and let the canvas fall back to DEFAULT_BACKGROUND_CSS. */
  backgroundData: { type: "color" | "gradient"; id: string } | null;
}

export async function setBackgroundAction(
  input: SetBackgroundInput,
): Promise<ActionResult> {
  if (typeof input.boardId !== "string" || input.boardId.length === 0) {
    return { ok: false, error: "شناسهٔ بورد معتبر نیست." };
  }
  if (
    input.backgroundData !== null &&
    (typeof input.backgroundData.type !== "string" ||
      typeof input.backgroundData.id !== "string")
  ) {
    return { ok: false, error: "داده‌های پس‌زمینه معتبر نیستند." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.boardManagement.setBackground({
      boardId: input.boardId,
      backgroundData: input.backgroundData,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath(`/board/${input.boardId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: persianMessage(err, "خطا در تغییر پس‌زمینه.") };
  }
}
