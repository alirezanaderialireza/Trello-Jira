// packages/infrastructure/src/auth/argon2Hasher.ts
// Argon2id password hashing — OWASP 2024 recommended.
// Falls back to @repo/auth PBKDF2 if @node-rs/argon2 is unavailable.

import type { PasswordHasher } from "@repo/domain/users";

let argon2: any = null;

async function getArgon2() {
  if (!argon2) {
    try {
      argon2 = await import("@node-rs/argon2");
    } catch {
      const { hashPassword, verifyPassword } = await import("@repo/auth");
      return { hash: hashPassword, verify: verifyPassword, fallback: true };
    }
  }
  return argon2;
}

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const mod = await getArgon2();
    if (mod.fallback) return mod.hash(password);
    return mod.hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
  }

  async verify(password: string, hash: string): Promise<boolean> {
    const mod = await getArgon2();
    if (mod.fallback) return mod.verify(password, hash);
    return mod.verify(hash, password);
  }
}
