// packages/db/src/schema/users.ts

import { pgTable, uuid, varchar, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 254 }).notNull(),
    emailNormalized: varchar("email_normalized", { length: 254 }).notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordHash: text("password_hash"), // null if magic-link only
    displayName: varchar("display_name", { length: 100 }).notNull(),
    locale: varchar("locale", { length: 10 }).notNull().default("fa"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("Asia/Tehran"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),

    // Phase 1.1 (mig 0006) — profile + preferences. `preferences` shape is
    // validated by domain-layer Zod (added in F2/F3); the DB CHECK only
    // enforces that the value is a JSON object.
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    preferences: jsonb("preferences").notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    emailUniqueIdx: uniqueIndex("idx_users_email_unique")
      .on(table.emailNormalized)
      .where(sql`${table.deletedAt} IS NULL`),
    lastSeenIdx: index("idx_users_last_seen").on(table.lastSeenAt),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
