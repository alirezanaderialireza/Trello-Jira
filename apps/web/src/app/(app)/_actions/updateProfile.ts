"use server";

// apps/web/src/app/(app)/_actions/updateProfile.ts
//
// Server Action wrapping `userProfile.updateProfile` (displayName,
// avatarUrl, bio).
//
// F4 ships this action without a consuming UI — Phase 1.2 will add
// the profile-edit page where the form will submit here. Having the
// action in place now means that future page can land as a pure UI
// commit without a coupled API change.
//
// Avatar UPLOAD (S3 presigned + multipart) is a separate concern,
// out of F4 scope. This action accepts an existing avatar URL only.

import { revalidatePath } from "next/cache";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";

export interface UpdateProfileInput {
  displayName?: string;
  avatarUrl?: string | null;
  bio?: string | null;
}

export interface UpdateProfileResult {
  ok: boolean;
  error?: string;
}

const DISPLAY_NAME_MAX = 100;
const BIO_MAX = 500;

export async function updateProfileAction(
  input: UpdateProfileInput,
): Promise<UpdateProfileResult> {
  // Client-side validation (Zod-equivalent ranges from
  // userProfile.router.ts schemas). The server router re-validates;
  // these checks just give a faster, friendlier error path.
  if (input.displayName !== undefined) {
    const trimmed = input.displayName.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: "نام نمایشی الزامی است." };
    }
    if (trimmed.length > DISPLAY_NAME_MAX) {
      return {
        ok: false,
        error: `نام نمایشی نباید از ${DISPLAY_NAME_MAX} کاراکتر بیشتر باشد.`,
      };
    }
  }
  if (input.bio !== undefined && input.bio !== null) {
    if (input.bio.length > BIO_MAX) {
      return {
        ok: false,
        error: `بیوگرافی نباید از ${BIO_MAX} کاراکتر بیشتر باشد.`,
      };
    }
  }

  const session = await getWebSession();
  if (!session) {
    return { ok: false, error: "نیاز به ورود مجدد است." };
  }

  const ctx = await createContext({ session: session as any });
  const caller = appRouter.createCaller(ctx);

  try {
    await caller.v1.public.userProfile.updateProfile({
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      bio: input.bio,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err: any) {
    const message =
      typeof err?.message === "string" && err.message.length < 200
        ? err.message
        : "خطایی در ذخیره پروفایل رخ داد.";
    return { ok: false, error: message };
  }
}
