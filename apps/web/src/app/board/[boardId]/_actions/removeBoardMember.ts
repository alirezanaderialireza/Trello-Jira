"use server";

// apps/web/src/app/board/[boardId]/_actions/removeBoardMember.ts
//
// Backs the "حذف از بورد" button on each row in the MembersTab.
// Calls v1.public.boardMembers.removeMember. The procedure rejects
// removal of the last OWNER and rejects ADMIN-removes-OWNER with
// Persian messages we surface verbatim via the toast.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { persianMessage, type ActionResult } from "./_helpers";

export interface RemoveBoardMemberInput {
  boardId: string;
  userId: string;
}

export async function removeBoardMemberAction(
  input: RemoveBoardMemberInput,
): Promise<ActionResult> {
  if (typeof input.boardId !== "string" || input.boardId.length === 0) {
    return { ok: false, error: "شناسهٔ بورد معتبر نیست." };
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return { ok: false, error: "شناسهٔ کاربر معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.boardMembers.removeMember({
      boardId: input.boardId,
      userId: input.userId,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath(`/board/${input.boardId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: persianMessage(err, "خطا در حذف عضو از بورد.") };
  }
}
