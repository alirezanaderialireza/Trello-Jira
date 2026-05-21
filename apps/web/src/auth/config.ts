// apps/web/src/auth/config.ts
// Auth.js v5 configuration — Credentials + DrizzleAdapter + Database sessions.

import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db, users, accounts, sessions, verificationTokens } from "@repo/db";
import { eq, and, isNull } from "drizzle-orm";
import { Argon2PasswordHasher } from "@repo/infrastructure/auth/argon2Hasher";

const hasher = new Argon2PasswordHasher();

export const authConfig: NextAuthConfig = {
  adapter: DrizzleAdapter(db as any, {
    usersTable: users as any,
    accountsTable: accounts as any,
    sessionsTable: sessions as any,
    verificationTokensTable: verificationTokens as any,
  }),
  providers: [
    Credentials({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const emailNorm = (credentials.email as string).toLowerCase().trim();

        const user = await (db as any)
          .select().from(users)
          .where(and(eq(users.emailNormalized, emailNorm), isNull(users.deletedAt)))
          .limit(1).then((r: any[]) => r[0] ?? null);

        if (!user || !user.passwordHash || !user.emailVerifiedAt) return null;
        const valid = await hasher.verify(credentials.password as string, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.displayName };
      },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "database" },
  callbacks: {
    session({ session, user }) {
      if (user?.id) session.user.id = user.id;
      return session;
    },
  },
};
