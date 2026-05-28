"use server";

// apps/web/src/app/(app)/_actions/createWorkspace.ts
//
// Server Action backing the sidebar's "+ فضای کاری جدید" dialog and
// the WorkspaceSwitcher's empty-state CTA.
//
// Architectural placement (per F4 plan adjustment): under
// `app/(app)/_actions/` so it sits in the `app` element of the
// boundaries linter — `app` is the only element allowed to import
// `@repo/api` runtime alongside Server Actions. Putting actions
// inside `features/` would tickle the boundaries rule (features
// can't reach into @repo/db transitively through the API caller).
//
// Returns a small JSON-serialisable result object so Client callers
// can branch on success/error without parsing exceptions. Throws
// only on truly fatal infra errors (no session, missing tenant) so
// the caller's defensive try/catch isn't exercised on every form
// submission with a duplicate slug.

import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export interface CreateWorkspaceResult {
  ok: boolean;
  /** Slug of the new workspace, populated only when `ok === true`. */
  slug?: string;
  /** Persian message safe to render in a toast. */
  error?: string;
}

const NAME_MAX = 100;

export async function createWorkspaceAction(
  formData: FormData,
): Promise<CreateWorkspaceResult> {
  const raw = formData.get("name");
  if (typeof raw !== "string") {
    return { ok: false, error: "نام فضای کاری معتبر نیست." };
  }
  const name = raw.trim();
  if (name.length === 0) {
    return { ok: false, error: "نام فضای کاری الزامی است." };
  }
  if (name.length > NAME_MAX) {
    return {
      ok: false,
      error: `نام فضای کاری نباید از ${NAME_MAX} کاراکتر بیشتر باشد.`,
    };
  }

  const session = await getWebSession();
  if (!session) {
    // Should be caught by middleware + layout earlier, but defensive.
    return { ok: false, error: "نیاز به ورود مجدد است." };
  }

  // Cast at the boundary — see note in (app)/layout.tsx: the trpc
  // Session type isn't re-exported from @repo/api, structural shapes
  // are identical.
  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    const result = await caller.v1.public.workspace.create({ name });
    // Revalidate paths that show the workspace list so the new entry
    // appears without a manual reload. The sidebar bootstrap query
    // is invalidated on the client by react-query after the action
    // returns.
    revalidatePath("/workspaces");
    revalidatePath("/", "layout"); // refresh (app)/layout's bootstrap fetch
    return { ok: true, slug: result.slug };
  } catch (err: any) {
    // tRPC errors carry a Persian `message` per F3a routers; surface
    // verbatim to the user. Any unknown error gets a generic Persian
    // fallback so we never echo English stack traces to the UI.
    const message =
      typeof err?.message === "string" && err.message.length < 200
        ? err.message
        : "خطایی در ساخت فضای کاری رخ داد.";
    return { ok: false, error: message };
  }
}
