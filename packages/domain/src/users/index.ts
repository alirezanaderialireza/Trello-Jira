// packages/domain/src/users/index.ts
// User bounded context — entities, value objects, ports, errors.

// ── Value Objects ────────────────────────────────────────────────────────────

/** Normalized email — always lowercase, trimmed. */
export type NormalizedEmail = string & { readonly __brand: "NormalizedEmail" };

export function normalizeEmail(raw: string): NormalizedEmail {
  const normalized = raw.toLowerCase().trim();
  if (normalized.length >= 254) throw new Error(`Invalid email: too long (${normalized.length} >= 254)`);
  if (!normalized || !normalized.includes("@")) {
    throw new Error(`Invalid email: "${raw}"`);
  }
  return normalized as NormalizedEmail;
}

// ── Password Policy ──────────────────────────────────────────────────────────

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < 8) errors.push("Password must be at least 8 characters");
  if (password.length > 128) errors.push("Password must be at most 128 characters");
  if (!/\d/.test(password)) errors.push("Password must contain at least one digit");
  if (!/[a-zA-Z]/.test(password)) errors.push("Password must contain at least one letter");
  return { valid: errors.length === 0, errors };
}

// ── Ports ────────────────────────────────────────────────────────────────────

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export interface UserRepository<TTx = unknown> {
  findById(id: string): Promise<UserEntity | null>;
  findByEmail(emailNormalized: NormalizedEmail): Promise<UserEntity | null>;
  create(user: UserEntity, tx?: TTx): Promise<void>;
  update(user: UserEntity, tx?: TTx): Promise<void>;
}

// ── Entity ───────────────────────────────────────────────────────────────────

export interface UserEntity {
  id: string;
  email: string;
  emailNormalized: NormalizedEmail;
  emailVerifiedAt: Date | null;
  passwordHash: string | null;
  displayName: string;
  locale: string;
  timezone: string;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class EmailAlreadyExistsError extends Error {
  constructor() { super("EMAIL_ALREADY_EXISTS"); this.name = "EmailAlreadyExistsError"; }
}

export class InvalidCredentialsError extends Error {
  constructor() { super("INVALID_CREDENTIALS"); this.name = "InvalidCredentialsError"; }
}

export class EmailNotVerifiedError extends Error {
  constructor() { super("EMAIL_NOT_VERIFIED"); this.name = "EmailNotVerifiedError"; }
}
