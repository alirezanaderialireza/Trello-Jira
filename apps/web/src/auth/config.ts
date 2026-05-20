// apps/web/src/auth/config.ts
// Auth.js v5 configuration — credentials provider.

import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db, users } from "@repo/db";
import { eq, and, isNull } from "drizzle-orm";
import { Argon2PasswordHasher } from "@repo/infrastructure/auth/argon2Hasher";

const hasher = new Argon2PasswordHasher();

export const authConfig: NextAuthConfig = {
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
  callbacks: {
    session({ session, token }) {
      if (token?.sub) session.user.id = token.sub;
      return session;
    },
    jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
  },
  session: { strategy: "jwt" },
};
