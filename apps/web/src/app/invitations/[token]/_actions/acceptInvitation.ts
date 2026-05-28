"use server";

// apps/web/src/app/invitations/[token]/_actions/acceptInvitation.ts
//
// Server Action backing the "پذیرش دعوت" button on the public
// /invitations/[token] page.
//
// Architectural placement: this action sits NEXT TO the page that
// uses it (one-shot, single caller) rather than under the global
// app/(app)/_actions/ shelf. The (app)/_actions/ directory is
// reserved for actions consumed by the authenticated shell;
// /invitations/[token] is a root-level public page (middleware
// whitelisted) so it gets its own _actions/ folder, matching the
// pattern Next.js documents for route-co-located private actions.
//
// The accept flow is delicate enough to warrant defensive logging:
//   • The tRPC procedure throws TRPCError with Persian messages
//     for each failure mode (revoked / expired / wrong email /
//     workspace deleted / not found). We surface those messages
//     verbatim to the toast.
//   • EMAIL_MISMATCH is special — the UI offers "خروج و ورود با
//     ایمیل درست" CTA. We detect it heuristically by message
//     substring because the underlying procedure does not return
//     a structured error code (D5).

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export interface AcceptInvitationActionResult {
  ok: boolean;
  /** Workspace id of the accepted invitation; populated only when `ok === true`. */
  workspaceId?: string;
  /** Workspace slug for navigation; carried through from the page (the
   * accept procedure itself returns workspaceId only). The page
   * provides the slug separately, so this field stays optional here. */
  workspaceSlug?: string;
  /** True when the membership already existed and accept was a no-op. */
  alreadyAccepted?: boolean;
  /** Persian message safe to render in a toast. */
  error?: string;
  /** True when the failure is `EMAIL_MISMATCH` — UI offers a sign-out CTA. */
  isEmailMismatch?: boolean;
}

const TOKEN_MAX = 64;

export async function acceptInvitationAction(
  token: string,
): Promise<AcceptInvitationActionResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > TOKEN_MAX) {
    return { ok: false, error: "توکن دعوت معتبر نیست." };
  }

  const session = await getWebSession();
  if (!session) {
    return {
      ok: false,
      error: "برای پذیرش دعوت ابتدا وارد حساب کاربری خود شوید.",
    };
  }

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    const result = await caller.v1.public.workspace.invitations.accept({
      token,
      idempotencyKey: crypto.randomUUID(),
    });

    // Refresh sidebar bootstrap (workspaces list) and any board / settings
    // pages that depend on membership state.
    revalidatePath("/", "layout");
    revalidatePath("/workspaces");

    return {
      ok: true,
      workspaceId: result.workspaceId,
      alreadyAccepted: result.alreadyAccepted ?? false,
    };
  } catch (err: any) {
    const message =
      typeof err?.message === "string" && err.message.length < 200
        ? err.message
        : "خطایی در پذیرش دعوت رخ داد.";

    // The accept procedure formats EMAIL_MISMATCH as:
    //   "این دعوت برای ایمیل دیگری ارسال شده. با حساب درست وارد شوید."
    // Match on a stable Persian substring rather than the full
    // string so a copy tweak in the API doesn't silently drop the
    // sign-out CTA in the UI.
    const isEmailMismatch =
      message.includes("ایمیل دیگری") || message.includes("حساب درست");

    return { ok: false, error: message, isEmailMismatch };
  }
}
