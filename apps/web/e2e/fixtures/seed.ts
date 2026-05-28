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

import path from "node:path";
import { fileURLToPath } from "node:url";

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

// Migrations folder is a relative path from this file to the
// monorepo's @repo/db package. Resolved with import.meta.url so
// the lookup works regardless of where Playwright is invoked from.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_FOLDER = path.resolve(
  __dirname,
  "../../../../packages/db/migrations",
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
    await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
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
