// packages/db/src/repositories/users.repository.ts
import { eq, and, isNull } from "drizzle-orm";
import { users } from "../schema";
import type { UserRepository, UserEntity, NormalizedEmail } from "@repo/domain/users";

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<UserEntity | null> {
    const rows = await this.db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1);
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async findByEmail(emailNormalized: NormalizedEmail): Promise<UserEntity | null> {
    const rows = await this.db.select().from(users).where(and(eq(users.emailNormalized, emailNormalized), isNull(users.deletedAt))).limit(1);
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async create(user: UserEntity, tx?: any): Promise<void> {
    const db = tx ?? this.db;
    await db.insert(users).values({
      id: user.id, email: user.email, emailNormalized: user.emailNormalized,
      emailVerifiedAt: user.emailVerifiedAt, passwordHash: user.passwordHash,
      displayName: user.displayName, locale: user.locale, timezone: user.timezone,
      lastSeenAt: user.lastSeenAt, createdAt: user.createdAt, updatedAt: user.updatedAt, deletedAt: user.deletedAt,
    });
  }

  async update(user: UserEntity, tx?: any): Promise<void> {
    const db = tx ?? this.db;
    await db.update(users).set({
      email: user.email, emailNormalized: user.emailNormalized,
      emailVerifiedAt: user.emailVerifiedAt, passwordHash: user.passwordHash,
      displayName: user.displayName, locale: user.locale, timezone: user.timezone,
      lastSeenAt: user.lastSeenAt, updatedAt: new Date(), deletedAt: user.deletedAt,
    }).where(eq(users.id, user.id));
  }

  private mapRow(row: any): UserEntity {
    return {
      id: row.id, email: row.email, emailNormalized: row.emailNormalized as NormalizedEmail,
      emailVerifiedAt: row.emailVerifiedAt, passwordHash: row.passwordHash,
      displayName: row.displayName, locale: row.locale, timezone: row.timezone,
      lastSeenAt: row.lastSeenAt, createdAt: row.createdAt, updatedAt: row.updatedAt, deletedAt: row.deletedAt,
    };
  }
}
