"use server";

// apps/web/src/app/(app)/_actions/inviteToWorkspace.ts
//
// Backs the "Invite member" modal in the Members tab. Calls
// v1.public.workspace.invitations.create which:
//   • Validates the email + role (Zod strict)
//   • Generates a 64-char base64url token
//   • Inserts into workspace_invitations (BYPASSRLS — recipient
//     isn't a member yet)
//   • Emits `workspace.invitation.created` outbox event
//
// The outbox event is consumed by the worker handler added in the
// previous F5a commit, which renders the Persian email and sends
// it via the configured EmailSender.
//
// Duplicate-invitation handling (D9): the create procedure throws
// CONFLICT with a Persian message ("این ایمیل دعوت معلق دارد") when
// an active invitation for the same email exists. We surface that
// message verbatim — no client-side de-dupe.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export type InvitationRole = "ADMIN" | "MEMBER";

export interface InviteToWorkspaceInput {
  workspaceId: string;
  email: string;
  role: InvitationRole;
}

export interface InviteToWorkspaceResult {
  ok: boolean;
  invitationId?: string;
  /** ISO 8601 — when the invitation expires. */
  expiresAt?: string;
  error?: string;
}

export async function inviteToWorkspaceAction(
  input: InviteToWorkspaceInput,
): Promise<InviteToWorkspaceResult> {
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) {
    return { ok: false, error: "شناسهٔ فضای کاری معتبر نیست." };
  }
  const email = (input.email ?? "").trim().toLowerCase();
  if (email.length === 0) return { ok: false, error: "ایمیل الزامی است." };
  if (email.length > 254) return { ok: false, error: "ایمیل بیش از حد طولانی است." };
  // Minimal RFC 5321 sniff — the procedure does the strict validation.
  if (!email.includes("@")) return { ok: false, error: "فرمت ایمیل صحیح نیست." };

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    const result = await caller.v1.public.workspace.invitations.create({
      workspaceId: input.workspaceId,
      email,
      role: input.role,
      idempotencyKey: crypto.randomUUID(),
    });
    revalidatePath("/", "layout");
    return {
      ok: true,
      invitationId: result.invitationId,
      expiresAt: result.expiresAt,
    };
  } catch (err: any) {
    return { ok: false, error: persianMessage(err) };
  }
}

function persianMessage(err: unknown): string {
  const message = (err as { message?: unknown })?.message;
  if (typeof message === "string" && message.length > 0 && message.length < 200) {
    return message;
  }
  return "خطایی در ارسال دعوت رخ داد.";
}
