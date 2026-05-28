// apps/web/playwright.config.ts
//
// Playwright config for the Phase 1.1 E2E smoke flow.
//
// Runtime contract (CRITICAL — read before adjusting):
//
//   1. The Next dev server is launched by Playwright's webServer
//      block. It runs against `DATABASE_URL_TEST` (a SEPARATE
//      database — typically `trello_e2e`) so a misconfigured spec
//      can never wipe the developer's local `trello_os` data.
//
//   2. The seed fixture (e2e/fixtures/seed.ts) drops + recreates
//      the public schema + applies migrations + inserts the
//      starting state in `beforeAll`. Each spec receives a clean
//      DB.
//
//   3. The MockEmailService configured by `@repo/api` captures
//      outbound mails (workspace invitations) so the spec can
//      assert the recipient's accept link without spinning up
//      an SMTP fixture.
//
// Sandbox awareness (master contract Section 8):
//   This config is written but NOT executed inside the agent
//   sandbox. `pnpm install`, `pnpm exec playwright install`, and
//   the dev server itself are blocked. The full run is a user-
//   local operation; see e2e/README.md for the runbook.

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

// Required env vars for the dev server under test. Spec authors
// should NOT read process.env directly — values are funneled
// through this config so a missing var fails fast at start-up.
const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST;
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const JWT_SECRET = process.env.JWT_SECRET ?? "e2e-jwt-secret-DO-NOT-USE-IN-PRODUCTION";
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? JWT_SECRET;

if (!TEST_DATABASE_URL) {
  throw new Error(
    "[playwright.config] DATABASE_URL_TEST is required and must point at a SEPARATE database (e.g. trello_e2e). Refusing to start: see apps/web/e2e/README.md.",
  );
}

if (TEST_DATABASE_URL.includes("trello_os") && !TEST_DATABASE_URL.includes("trello_os_e2e")) {
  // Defence-in-depth: refuse to run against a URL that names the
  // dev DB. The seed fixture's DROP SCHEMA would otherwise destroy
  // local development data.
  throw new Error(
    "[playwright.config] DATABASE_URL_TEST appears to point at the dev DB (`trello_os`). Use a SEPARATE database (e.g. `trello_e2e`).",
  );
}

export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: false, // The smoke flow is sequential; parallelism would require per-test seed reset.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["list"]]
    : [["html", { open: "on-failure" }], ["list"]],
  timeout: 60_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
    extraHTTPHeaders: {
      "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.5",
    },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } },
    },
    {
      // iPhone SE viewport (375x667) — the smallest supported breakpoint
      // per the master contract Persian-first conventions. The smoke
      // flow runs against both projects so mobile-specific bottom-sheet
      // behaviours are covered.
      //
      // F5c hotfix: explicit `browserName: "chromium"` overrides the
      // WebKit default that ships with `devices["iPhone SE"]`. The CI
      // job only installs Chromium ("playwright install --with-deps
      // chromium") because the steering doc says "no separate WebKit
      // install needed". Without the override, the project tries to
      // launch WebKit and fails with "Executable doesn't exist". The
      // viewport + user-agent bits of the iPhone SE descriptor still
      // apply — just running them on Chromium's rendering engine.
      name: "mobile-iphone-se",
      use: {
        ...devices["iPhone SE"],
        browserName: "chromium",
      },
    },
  ],

  webServer: {
    command: "pnpm dev",
    cwd: ".",
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_URL_TEST: TEST_DATABASE_URL,
      REDIS_URL,
      JWT_SECRET,
      NEXTAUTH_SECRET,
      AUTH_TRUST_HOST: "true",
      NEXT_PUBLIC_APP_URL: BASE_URL,
      // The MockEmailService (@repo/api/services/emailService.ts) is
      // selected automatically when NODE_ENV !== "production" and
      // RESEND_API_KEY is missing. Captured emails are inspected
      // via the seed fixture's helper so the spec can extract the
      // accept-invitation token without an SMTP fixture.
      NODE_ENV: "test",
    },
  },
});
