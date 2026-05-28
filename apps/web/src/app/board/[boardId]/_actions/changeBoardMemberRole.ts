"use server";

// apps/web/src/app/board/[boardId]/_actions/changeBoardMemberRole.ts
//
// Backs the role select in the MembersTab. Calls
// v1.public.boardMembers.changeRole. Note the procedure parameter
// name is `newRole` (NOT `role` — that distinguishes it from the
// inviteMember input shape).

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { persianMessage, type ActionResult } from "./_helpers";

export type BoardRole = "OWNER" | "ADMIN" | "MEMBER";

export interface ChangeBoardMemberRoleInput {
  boardId: string;
  userId: string;
  newRole: BoardRole;
}

export async function changeBoardMemberRoleAction(
  input: ChangeBoardMemberRoleInput,
): Promise<ActionResult> {
  if (typeof input.boardId !== "string" || input.boardId.length === 0) {
    return { ok: false, error: "شناسهٔ بورد معتبر نیست." };
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return { ok: false, error: "شناسهٔ کاربر معتبر نیست." };
  }
  if (
    input.newRole !== "OWNER" &&
    input.newRole !== "ADMIN" &&
    input.newRole !== "MEMBER"
  ) {
    return { ok: false, error: "نقش انتخابی معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.boardMembers.changeRole({
      boardId: input.boardId,
      userId: input.userId,
      newRole: input.newRole,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath(`/board/${input.boardId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: persianMessage(err, "خطا در تغییر نقش عضو.") };
  }
}
