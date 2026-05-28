"use server";

// apps/web/src/app/(app)/_actions/transferOwnership.ts
//
// Backs the TransferOwnershipDialog in the Members tab. Calls
// v1.public.workspace.members.transferOwnership which atomically:
//   • Demotes the current OWNER to ADMIN
//   • Promotes the target member to OWNER
//   • Emits workspace.ownership_transferred outbox event
//
// Only the current OWNER can invoke this. After success the calling
// user is no longer OWNER, so any UI that relied on owner-only
// affordances (Danger tab, etc.) needs revalidating — we trigger
// a layout-level revalidate so the role chip + tab gates refresh.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export interface TransferOwnershipInput {
  workspaceId: string;
  newOwnerId: string;
}

export interface TransferOwnershipResult {
  ok: boolean;
  error?: string;
}

export async function transferOwnershipAction(
  input: TransferOwnershipInput,
): Promise<TransferOwnershipResult> {
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) {
    return { ok: false, error: "شناسهٔ فضای کاری معتبر نیست." };
  }
  if (typeof input.newOwnerId !== "string" || input.newOwnerId.length === 0) {
    return { ok: false, error: "شناسهٔ مالک جدید معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.workspace.members.transferOwnership({
      workspaceId: input.workspaceId,
      newOwnerId: input.newOwnerId,
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
  return "خطایی در انتقال مالکیت رخ داد.";
}
