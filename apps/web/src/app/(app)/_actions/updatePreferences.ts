"use server";

// apps/web/src/app/(app)/_actions/updatePreferences.ts
//
// Server Action wrapping `userProfile.updatePreferences`.
//
// F4 wires this only for locale toggling in the ProfileDropdown.
// timezone picker and theme selector UIs land in a future phase;
// the action is generic so those can plug in without modification.

import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export interface UpdatePreferencesInput {
  locale?: "fa" | "en";
  timezone?: string;
  preferences?: Record<string, unknown>;
}

export interface UpdatePreferencesResult {
  ok: boolean;
  error?: string;
}

export async function updatePreferencesAction(
  input: UpdatePreferencesInput,
): Promise<UpdatePreferencesResult> {
  const session = await getWebSession();
  if (!session) {
    return { ok: false, error: "نیاز به ورود مجدد است." };
  }

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.userProfile.updatePreferences(input);
    // Layout-level revalidation so the next render of (app)/layout
    // pulls fresh sidebar.bootstrap.currentUser.locale/timezone.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err: any) {
    const message =
      typeof err?.message === "string" && err.message.length < 200
        ? err.message
        : "خطایی در ذخیره تنظیمات رخ داد.";
    return { ok: false, error: message };
  }
}
