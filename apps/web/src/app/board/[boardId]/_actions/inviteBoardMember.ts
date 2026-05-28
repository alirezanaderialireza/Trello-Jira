"use server";

// apps/web/src/app/board/[boardId]/_actions/inviteBoardMember.ts
//
// Backs the MembersTab invite modal. Calls
// v1.public.boardMembers.inviteMember. Note that boards have a
// workspace-member-first invariant — the user must already be a
// workspace member; this is enforced inside the addBoardMember
// domain use case. The modal therefore picks userId from the
// workspace members list rather than asking for an email
// (workspace-level invitations live on the F5a workspace settings
// page).

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

import { persianMessage, type ActionResult } from "./_helpers";

export type BoardRole = "OWNER" | "ADMIN" | "MEMBER";

export interface InviteBoardMemberInput {
  boardId: string;
  userId: string;
  role: BoardRole;
}

export interface InviteBoardMemberResult extends ActionResult {
  /** True when the user was already an active board member (idempotent). */
  alreadyMember?: boolean;
  memberId?: string;
}

export async function inviteBoardMemberAction(
  input: InviteBoardMemberInput,
): Promise<InviteBoardMemberResult> {
  if (typeof input.boardId !== "string" || input.boardId.length === 0) {
    return { ok: false, error: "شناسهٔ بورد معتبر نیست." };
  }
  if (typeof input.userId !== "string" || input.userId.length === 0) {
    return { ok: false, error: "شناسهٔ کاربر معتبر نیست." };
  }
  if (
    input.role !== "OWNER" &&
    input.role !== "ADMIN" &&
    input.role !== "MEMBER"
  ) {
    return { ok: false, error: "نقش انتخابی معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    const result = await caller.v1.public.boardMembers.inviteMember({
      boardId: input.boardId,
      userId: input.userId,
      role: input.role,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath(`/board/${input.boardId}`);
    return {
      ok: true,
      alreadyMember: (result as { alreadyMember?: boolean })?.alreadyMember ?? false,
      memberId: (result as { memberId?: string })?.memberId,
    };
  } catch (err) {
    return { ok: false, error: persianMessage(err, "خطا در دعوت عضو به بورد.") };
  }
}
