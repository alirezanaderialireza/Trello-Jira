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
//   The (auth) pages predate F4 and use plain <label> elements
//   without `htmlFor`, so Playwright's `getByLabel` doesn't bind
//   to them. We use stable structural selectors instead:
//     • `input[type="email"]`     — there is only one per page
//     • `input[type="password"]`  — same
//     • `getByRole("button", ...) — submit button by Persian name
//   This keeps the spec resilient to copy tweaks while not
//   depending on classnames that change between Tailwind-version
//   bumps.

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

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
 * Sign up a new user. Magic-link verification is auto-confirmed in
 * dev (per the auth flow spec D-5 in steering/auth-workspaces.md),
 * so successful signup leaves the user on `/workspaces`.
 */
export async function signUp(page: Page, params: SignupParams): Promise<void> {
  await page.goto("/signup");
  await page.locator('input[name="displayName"], input[placeholder*="نام"]').first().fill(params.displayName);
  await page.locator('input[type="email"]').fill(params.email);
  await page.locator('input[type="password"]').fill(params.password);
  await page.getByRole("button", { name: /ثبت‌نام|signup|sign up/i }).click();
  // Either lands on /workspaces (auto-verified flow) OR on
  // /verify-email (when the email layer requires manual confirm).
  // The spec only cares that we are signed in afterwards — assert
  // either landing page.
  await page.waitForURL(/\/(workspaces|verify-email)/, { timeout: 15_000 });
}

/**
 * Sign in via the credentials form. Returns once the post-login
 * redirect lands on /workspaces (or the configured callback URL).
 */
export async function signIn(page: Page, params: SignInParams): Promise<void> {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(params.email);
  await page.locator('input[type="password"]').fill(params.password);
  await page.getByRole("button", { name: /ورود|login|sign in/i }).click();
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
