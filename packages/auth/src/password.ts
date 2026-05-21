// packages/auth/src/password.ts
// Password hashing using Web Crypto API (PBKDF2 + SHA-256).
// Zero external dependencies.

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Hashes a password with PBKDF2-SHA256.
 * Returns a string in format: `<salt_hex>:<hash_hex>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEY_BYTES * 8,
  );

  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashHex = Array.from(new Uint8Array(derived)).map((b) => b.toString(16).padStart(2, "0")).join("");

  return `${saltHex}:${hashHex}`;
}

/**
 * Verifies a password against a stored hash.
 * Returns true if the password matches.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, expectedHashHex] = storedHash.split(":");
  if (!saltHex || !expectedHashHex) return false;

  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEY_BYTES * 8,
  );

  const hashHex = Array.from(new Uint8Array(derived)).map((b) => b.toString(16).padStart(2, "0")).join("");

  // Constant-time comparison
  if (hashHex.length !== expectedHashHex.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hashHex.length; i++) {
    mismatch |= hashHex.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
  }
  return mismatch === 0;
}
