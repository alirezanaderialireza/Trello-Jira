"use server";

// apps/web/src/app/(app)/_actions/revokeInvitation.ts
//
// Backs the "لغو" button next to each row in the pending-invitations
// list. Calls v1.public.workspace.invitations.revoke which sets
// `revoked_at = NOW()` (admin-gated, idempotent).

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export interface RevokeInvitationInput {
  workspaceId: string;
  invitationId: string;
}

export interface RevokeInvitationResult {
  ok: boolean;
  error?: string;
}

export async function revokeInvitationAction(
  input: RevokeInvitationInput,
): Promise<RevokeInvitationResult> {
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) {
    return { ok: false, error: "شناسهٔ فضای کاری معتبر نیست." };
  }
  if (typeof input.invitationId !== "string" || input.invitationId.length === 0) {
    return { ok: false, error: "شناسهٔ دعوت معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.workspace.invitations.revoke({
      workspaceId: input.workspaceId,
      invitationId: input.invitationId,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: persianMessage(err) };
  }
}

function persianMessage(err: unknown): string {
  const message = (err as { message?: unknown })?.message;
  if (typeof message === "string" && message.length > 0 && message.length < 200) {
    return message;
  }
  return "خطایی در لغو دعوت رخ داد.";
}
