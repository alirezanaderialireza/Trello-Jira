// packages/db/scripts/check-migrations.mjs
//
// Fresh-DB provisioning guard + diagnostic (C-01 follow-up).
//
// Applies EVERY migration listed in meta/_journal.json, in idx order, against
// the database in $DATABASE_URL — each migration in its own transaction, which
// mirrors how `drizzle-kit migrate` runs files (breakpoints: true, no
// `--> statement-breakpoint` markers ⇒ whole file = one transactional batch).
//
// Why this exists: `drizzle-kit migrate` wraps its work in an ora spinner that
// swallows the underlying Postgres error, so a failing migration just prints
// "applying migrations..." then exits 1 with no clue which file or why. This
// script prints the exact failing migration tag + the full pg error
// (message / detail / hint / position), making fresh-DB provisioning
// regressions debuggable in CI.
//
// Usage:  DATABASE_URL=postgres://... node scripts/check-migrations.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");
const journalPath = path.join(migrationsDir, "meta", "_journal.json");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("✗ DATABASE_URL is not set.");
  process.exit(1);
}

const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

const client = new Client({ connectionString: databaseUrl });

async function main() {
  await client.connect();
  console.log(
    `Applying ${entries.length} migration(s) from the journal to a fresh DB...\n`,
  );

  for (const entry of entries) {
    const file = path.join(migrationsDir, `${entry.tag}.sql`);
    const sql = readFileSync(file, "utf8");
    process.stdout.write(
      `  → [${String(entry.idx).padStart(2, "0")}] ${entry.tag} ... `,
    );
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("COMMIT");
      console.log("OK");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.log("FAILED");
      console.error(`\n✗ Migration failed: ${entry.tag}.sql`);
      console.error(`  message : ${err.message}`);
      if (err.detail) console.error(`  detail  : ${err.detail}`);
      if (err.hint) console.error(`  hint    : ${err.hint}`);
      if (err.where) console.error(`  where   : ${err.where}`);
      if (err.position) console.error(`  position: ${err.position}`);
      if (err.code) console.error(`  sqlstate: ${err.code}`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log("\n✓ All migrations applied cleanly on a fresh database.");
}

main().catch(async (err) => {
  console.error("\n✗ Unexpected error:", err);
  try {
    await client.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
