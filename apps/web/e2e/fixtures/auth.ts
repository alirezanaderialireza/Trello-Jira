// apps/web/e2e/fixtures/auth.ts
//
// UI-driven auth helpers for the Phase 1.1 smoke flow.
//
// Why we drive the UI (instead of programmatically inserting
// session cookies):
//   The smoke spec's whole point is to verify that the user-
//   facing flow works end-to-end — that includes the auth
//   pages. Bypassing them via a session-cookie shortcut would
//   skip whatever they happen to break.
//
// Selector strategy:
//   After F1.4.5 every (auth) input has a unique `id` + a matching
//   `<label htmlFor>`, so Playwright's `getByLabel` binds correctly.
//   We target inputs by their Persian label and the submit button by
//   role + Persian name.
//   NOTE: on /signup, the label "رمز عبور" is a substring of
//   "تکرار رمز عبور", so both password fields use { exact: true } to
//   stay unambiguous under Playwright strict mode.

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { seedFixture } from "./seed";

export interface SignupParams {
  displayName: string;
  email: string;
  password: string;
}

export interface SignInParams {
  email: string;
  password: string;
}

/**
 * Sign up a new user, then bypass email verification + sign in via
 * the credentials form so the caller is left fully authenticated
 * on /workspaces.
 *
 * Why the three-step dance:
 *   The signup route at /api/auth/signup creates the user with
 *   `email_verified_at = NULL` by design (production sends a real
 *   verification email). The (auth) page then renders an inline
 *   success card on /signup — there is NO redirect. Auth.js's
 *   credentials provider in apps/web/src/auth/config.ts refuses to
 *   sign in any user whose `emailVerifiedAt` is null. So the spec
 *   would otherwise be stuck on the success card, never reaching
 *   /workspaces.
 *
 *   The fixture sidesteps this by writing `email_verified_at = NOW()`
 *   directly into the DB (the email rendering itself is covered by
 *   F5a unit tests; the spec only cares about post-auth flow), then
 *   driving the login UI like a real user.
 *
 * Selector strategy:
 *   After F1.4.5 the signup inputs have `id` + `<label htmlFor>` AND
 *   stable `name` attributes. We use getByLabel (Persian labels).
 *   The form has TWO password fields whose labels are "رمز عبور" and
 *   "تکرار رمز عبور" — since the former is a substring of the latter,
 *   both use { exact: true } so Playwright strict mode picks exactly one.
 */
export async function signUp(page: Page, params: SignupParams): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("نام نمایشی").fill(params.displayName);
  await page.getByLabel("ایمیل", { exact: true }).fill(params.email);
  await page.getByLabel("رمز عبور", { exact: true }).fill(params.password);
  await page.getByLabel("تکرار رمز عبور", { exact: true }).fill(params.password);
  await page.getByRole("button", { name: /ثبت‌نام/ }).click();

  // Wait for the inline success card. The page has BOTH an h1 and a
  // descriptive paragraph that contain Persian text matching the
  // success state — we anchor on the heading role for an unambiguous
  // strict-mode match.
  await page.getByRole("heading", { name: /ثبت‌نام موفق/ }).waitFor({ timeout: 15_000 });

  // Bypass email verification. The seed fixture writes
  // `email_verified_at = NOW()` directly so the credentials
  // provider stops rejecting the user. Email rendering itself is
  // covered by F5a unit tests; the spec only cares about the
  // post-auth flow.
  const updated = await seedFixture.markEmailVerified(params.email);
  if (updated === 0) {
    throw new Error(
      `[e2e/auth] signUp: markEmailVerified found no row for ${params.email}. ` +
        `Either the signup POST silently failed or the email_normalized lookup ` +
        `did not match. Check the dev server stderr for [signup] error logs.`,
    );
  }

  // Sign in via the credentials form.
  await signIn(page, { email: params.email, password: params.password });
}

/**
 * Sign in via the credentials form. Returns once the post-login
 * redirect lands on /workspaces (or the configured callback URL).
 */
export async function signIn(page: Page, params: SignInParams): Promise<void> {
  await page.goto("/login");
  // (auth) pages now have htmlFor + id (F1.4.5), so getByLabel binds.
  // Login labels "ایمیل" / "رمز عبور" are each unique on this page.
  await page.getByLabel("ایمیل", { exact: true }).fill(params.email);
  await page.getByLabel("رمز عبور", { exact: true }).fill(params.password);
  await page.getByRole("button", { name: /ورود/ }).click();
  await expect(page).toHaveURL(/\/workspaces|\/invitations\//, { timeout: 15_000 });
}

/**
 * Sign out via the topnav profile dropdown. Lands on /login.
 */
export async function signOut(page: Page): Promise<void> {
  // Open the profile dropdown — the trigger is the avatar/chevron
  // button in the topnav. We match by role + name to stay resilient
  // to icon-button class changes.
  await page.getByRole("button", { name: /پروفایل|profile|menu|user/i }).first().click();
  await page.getByRole("menuitem", { name: /خروج|logout|sign out/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
}
