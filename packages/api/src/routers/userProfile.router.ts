// packages/api/src/routers/userProfile.router.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// User profile router (F3b).
//
// Surfaces the logged-in user's own profile and lets them update display
// name, avatar URL, bio, locale, timezone, and free-form preferences
// (theme, sidebar collapsed state, default board view).
//
// No outbox events (D3 from F3b plan):
//   • outbox is tenant-scoped; user-level events would break that
//     invariant.
//   • cross-tab sync (locale change in tab A → tab B) is handled
//     client-side via BroadcastChannel in F4.
//   • cross-user observability (member list refresh on displayName
//     change) is deferred to a future infra phase if telemetry shows
//     it's needed.
//
// Email update is intentionally out of scope (D4): it requires a full
// re-verification flow and lives in a separate auth featurelet.
//
// Avatar upload is out of scope (D5): the procedure takes an avatar
// URL; presigned-S3 upload is a separate concern.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { router, protectedProcedure } from "../trpc";
import { users } from "@repo/db";

// ─── Schemas ────────────────────────────────────────────────────────────────

/**
 * Free-form preferences shape (D6 from F3b plan).
 *
 * `passthrough()` preserves unknown keys so the UI can ship a new
 * preference (e.g. `defaultBoardView: "calendar"`) without first bumping
 * this validator + redeploying the API. The DB has a CHECK that enforces
 * `jsonb_typeof = 'object'` and the column is JSONB so any structurally-
 * valid object survives.
 */
const PreferencesSchema = z
  .object({
    theme: z.enum(["light", "dark", "system"]).optional(),
    sidebarCollapsed: z.boolean().optional(),
    defaultBoardView: z.enum(["board", "list", "calendar"]).optional(),
  })
  .passthrough();

const LocaleSchema = z.enum(["fa", "en"]);
const TimezoneSchema = z.string().min(1).max(64);
const DisplayNameSchema = z.string().trim().min(1).max(100);
const AvatarUrlSchema = z.string().url().max(2048).nullable();
const BioSchema = z.string().trim().max(500).nullable();

// ─── Router ─────────────────────────────────────────────────────────────────

export const userProfileRouter = router({
  // ── me (self profile) ────────────────────────────────────────────────────
  //
  // Returns the current user's full profile minus security-sensitive
  // fields (passwordHash never leaves the DB layer; emailNormalized is
  // an internal lookup column not for client display).
  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.infra.db.query.users.findFirst({
      where: eq(users.id, ctx.session.user.id),
    });

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "کاربر یافت نشد.",
      });
    }

    return {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt
        ? user.emailVerifiedAt.toISOString()
        : null,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      bio: user.bio ?? null,
      locale: user.locale,
      timezone: user.timezone,
      preferences: user.preferences ?? {},
      lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
    };
  }),

  // ── updatePreferences (locale, timezone, theme, …) ───────────────────────
  //
  // locale and timezone are top-level columns (own indices); preferences
  // is a JSONB blob merged (NOT replaced) so a partial update doesn't
  // wipe out fields the client didn't send.
  //
  // No outbox event — see header.
  updatePreferences: protectedProcedure
    .input(
      z.object({
        locale: LocaleSchema.optional(),
        timezone: TimezoneSchema.optional(),
        preferences: PreferencesSchema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // At least one updatable field must be present.
      if (
        input.locale === undefined &&
        input.timezone === undefined &&
        input.preferences === undefined
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "حداقل یک فیلد برای ویرایش لازم است.",
        });
      }

      const current = await ctx.infra.db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
      });
      if (!current) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "کاربر یافت نشد.",
        });
      }

      // Merge preferences with existing data — partial updates do not
      // wipe out fields the client didn't send.
      const mergedPreferences = input.preferences
        ? { ...(current.preferences as Record<string, unknown>), ...input.preferences }
        : current.preferences;

      await ctx.infra.db
        .update(users)
        .set({
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          ...(input.preferences !== undefined
            ? { preferences: mergedPreferences }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.session.user.id));

      return {
        success: true,
        locale: input.locale ?? current.locale,
        timezone: input.timezone ?? current.timezone,
        preferences: mergedPreferences ?? {},
      };
    }),

  // ── updateProfile (display name, avatar URL, bio) ────────────────────────
  //
  // No outbox event — see header.
  updateProfile: protectedProcedure
    .input(
      z.object({
        displayName: DisplayNameSchema.optional(),
        avatarUrl: AvatarUrlSchema.optional(),
        bio: BioSchema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // At least one updatable field must be present.
      if (
        input.displayName === undefined &&
        input.avatarUrl === undefined &&
        input.bio === undefined
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "حداقل یک فیلد برای ویرایش لازم است.",
        });
      }

      await ctx.infra.db
        .update(users)
        .set({
          ...(input.displayName !== undefined
            ? { displayName: input.displayName }
            : {}),
          ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.session.user.id));

      return { success: true };
    }),
});
