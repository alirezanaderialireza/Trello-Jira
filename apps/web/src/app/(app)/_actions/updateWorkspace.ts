"use server";

// apps/web/src/app/(app)/_actions/updateWorkspace.ts
//
// Backs the General settings tab. Updates name / description / slug
// (via v1.public.workspace.update) and visibility (via
// v1.public.workspace.updateVisibility) in a single Server Action
// invocation. Visibility is a separate procedure on the server (it
// requires OWNER role; the metadata update only requires ADMIN), so
// we issue two tRPC calls when both kinds of fields change.
//
// On a partial failure (metadata succeeds, visibility fails), the
// action returns the visibility error verbatim. The form keeps the
// user on the page so they can retry without losing the typed
// values.

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export interface UpdateWorkspaceInput {
  workspaceId: string;
  name?: string;
  description?: string | null;
  slug?: string;
  visibility?: "private" | "public";
}

export interface UpdateWorkspaceResult {
  ok: boolean;
  /** New slug — populated only when slug changed and update succeeded.
   * The page redirects to the new slug-based URL on success. */
  slug?: string;
  error?: string;
}

const NAME_MAX = 100;
const DESCRIPTION_MAX = 1000;

export async function updateWorkspaceAction(
  input: UpdateWorkspaceInput,
): Promise<UpdateWorkspaceResult> {
  // ── Lightweight client-trust validation. The tRPC procedure does
  //    its own zod validation; we re-check the basics here so the
  //    user gets a Persian message instead of a raw zod string.
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) {
    return { ok: false, error: "شناسهٔ فضای کاری معتبر نیست." };
  }
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length === 0) return { ok: false, error: "نام فضای کاری الزامی است." };
    if (trimmed.length > NAME_MAX) {
      return { ok: false, error: `نام فضای کاری نباید از ${NAME_MAX} کاراکتر بیشتر باشد.` };
    }
  }
  if (input.description !== undefined && input.description !== null) {
    if (input.description.length > DESCRIPTION_MAX) {
      return { ok: false, error: `توضیحات نباید از ${DESCRIPTION_MAX} کاراکتر بیشتر باشد.` };
    }
  }

  const session = await getWebSession();
  if (!session) return { ok: false, error: "نیاز به ورود مجدد است." };

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  const hasMetadataChange =
    input.name !== undefined ||
    input.description !== undefined ||
    input.slug !== undefined;
  const hasVisibilityChange = input.visibility !== undefined;

  let resultSlug: string | undefined;

  try {
    if (hasMetadataChange) {
      const metadataResult = await caller.v1.public.workspace.update({
        workspaceId: input.workspaceId,
        name: input.name?.trim(),
        description:
          input.description === null ? undefined : input.description?.trim(),
        slug: input.slug?.trim(),
        idempotencyKey: crypto.randomUUID(),
      });
      // The procedure return shape varies (ResultWorkspace, etc.) —
      // we extract slug if present to drive the page-level redirect.
      resultSlug = (metadataResult as { slug?: string })?.slug;
    }

    if (hasVisibilityChange) {
      await caller.v1.public.workspace.updateVisibility({
        workspaceId: input.workspaceId,
        visibility: input.visibility!,
        idempotencyKey: crypto.randomUUID(),
      });
    }

    revalidatePath("/", "layout");
    return { ok: true, slug: resultSlug };
  } catch (err: any) {
    return { ok: false, error: persianMessage(err) };
  }
}

function persianMessage(err: unknown): string {
  const message = (err as { message?: unknown })?.message;
  if (typeof message === "string" && message.length > 0 && message.length < 200) {
    return message;
  }
  return "خطایی در ذخیره تغییرات رخ داد.";
}
