// packages/api/src/services/invitationTokenService.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Invitation Token Service (F3a.3)
//
// Helpers for token masking and email masking used by the `getByToken`
// procedure to return safe data to unauthenticated callers.
//
// Token generation lives in the repository (DrizzleWorkspaceInvitationsRepository)
// — this service does NOT generate tokens, only masks/presents them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mask a token for logging purposes.
 * Shows only the last 4 characters, prefixed with `tok:***`.
 *
 * Example: "abc123defg..." → "tok:***efg."
 */
export function maskToken(token: string): string {
  if (token.length <= 4) return "tok:****";
  return `tok:***${token.slice(-4)}`;
}

/**
 * Mask an email for display on the accept page.
 * Shows first char + last char before @, masks the rest.
 *
 * Examples:
 *   "ali@example.com"       → "a**@example.com"
 *   "alireza@example.com"   → "a*****a@example.com"
 *   "ab@example.com"        → "a*@example.com"
 *   "a@example.com"         → "a@example.com" (single char — no mask)
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return email; // defensive — invalid email, return as-is

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex); // includes @

  if (local.length <= 1) {
    return email; // single char — nothing to mask
  }

  if (local.length === 2) {
    return `${local[0]}*${domain}`;
  }

  // Show first and last character, mask middle
  const masked = `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}`;
  return `${masked}${domain}`;
}
