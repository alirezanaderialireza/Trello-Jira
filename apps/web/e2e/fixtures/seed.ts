// apps/web/e2e/fixtures/seed.ts
//
// Programmatic database management for the Phase 1.1 E2E smoke
// flow. Encapsulates two responsibilities:
//
//   1. resetDatabase()       — DROP SCHEMA + CREATE + apply
//                              migrations on the SEPARATE
//                              `DATABASE_URL_TEST` database.
//                              Called from the spec's `test.beforeAll`
//                              so each Playwright run starts clean.
//
//   2. getInvitationToken()  — read the latest active invitation
//                              token for a given email. Used to
//                              build the /invitations/[token] URL
//                              that User B follows during the
//                              accept-invitation step. Skips the
//                              email-capture round trip — the spec
//                              cares about the FLOW, not whether
//                              the rendered HTML matches the F5a
//                              template byte-for-byte (those have
//                              their own unit-test coverage).
//
// Defensive guards (CRITICAL):
//   • DATABASE_URL_TEST is required.
//   • If the URL contains `trello_os` (the dev DB name) without
//     a `_e2e` suffix, the module throws at import time. Devs who
//     accidentally run the spec with their dev URL in the env get
//     a loud refusal instead of a destroyed DB.
//
// Module-system note (F5c hotfix):
//   This file deliberately does NOT use `import.meta.url`. Playwright
//   auto-detects the host project's module system from its
//   package.json — `apps/web` has no `"type": "module"`, so
//   Playwright's TS loader compiles to CommonJS. `import.meta.url`
//   in a CJS-compiled file blows up in CI with
//   "ReferenceError: exports is not defined in ES module scope".
//   We resolve the migrations folder from `process.cwd()` instead;
//   Playwright sets cwd to `apps/web/` for both `pnpm --filter web
//   e2e` and the playwright-config `webServer.cwd: "."` setting.

import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL_TEST;

if (!DATABASE_URL) {
  throw new Error(
    "[e2e/seed] DATABASE_URL_TEST is required. Point it at a SEPARATE database (e.g. trello_e2e). See apps/web/e2e/README.md.",
  );
}

if (DATABASE_URL.includes("trello_os") && !DATABASE_URL.includes("trello_os_e2e")) {
  throw new Error(
    "[e2e/seed] DATABASE_URL_TEST appears to point at the dev DB (`trello_os`). The seed performs a destructive DROP SCHEMA — refusing to start. Use a SEPARATE database (e.g. `trello_e2e`).",
  );
}

// Single shared connection for the spec's lifetime. `max: 1` keeps
// concurrent migrate/seed calls predictable (only one statement in
// flight at a time).
const client = postgres(DATABASE_URL, { max: 1, prepare: false });
const db = drizzle(client);

// Migrations folder, resolved from process.cwd(). Playwright invokes
// the test runner with cwd = apps/web/ (the package directory, set
// by `pnpm --filter web ...` and confirmed by the
// `webServer.cwd: "."` directive in playwright.config.ts). From
// there, `../../packages/db/migrations` reaches the monorepo's
// @repo/db migrations directory.
const MIGRATIONS_FOLDER = path.resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
);

// ─────────────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────────────

export interface SeedFixture {
  resetDatabase: () => Promise<void>;
  getInvitationToken: (email: string) => Promise<string | null>;
  /** Closes the underlying postgres connection. Call from `test.afterAll`. */
  dispose: () => Promise<void>;
}

export const seedFixture: SeedFixture = {
  resetDatabase: async () => {
    // DROP SCHEMA cascades through every table, view, sequence,
    // policy, and function. Then we recreate the empty schema and
    // re-apply migrations so the Drizzle migration journal lines
    // up with the (now empty) DB.
    //
    // CRITICAL: also drop the `drizzle` schema. It hosts
    // `__drizzle_migrations` (the migration journal). If we leave
    // it intact, the next `migrate()` call sees the journal as
    // already-applied and skips creating any tables — leaving
    // `public` empty and the next signup query failing with
    // "relation \"users\" does not exist". This bites whenever
    // beforeAll runs more than once in a session (e.g. Playwright
    // worker restart after a test failure).
    await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
    // Some migrations install extensions in the public schema
    // (e.g. pgcrypto for gen_random_uuid). Granting USAGE here so
    // the role under test can install them.
    await db.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`);

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  },

  getInvitationToken: async (email: string) => {
    const normalized = email.trim().toLowerCase();
    const rows = await client<{ token: string }[]>`
      SELECT token
      FROM workspace_invitations
      WHERE invited_email = ${normalized}
        AND revoked_at IS NULL
        AND accepted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows[0]?.token ?? null;
  },

  dispose: async () => {
    await client.end({ timeout: 5 });
  },
};
