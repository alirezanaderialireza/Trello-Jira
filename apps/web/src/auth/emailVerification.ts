// apps/web/src/auth/emailVerification.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Email-verification token issuance + email dispatch.
//
// Used by:
//   • POST /api/auth/signup            (issues a token after creating the user)
//   • POST /api/auth/resend-verification (re-issues a token on demand)
//
// Convention:
//   We piggy-back on the Auth.js `verification_tokens` table by prefixing the
//   `identifier` column with `email-verify:`. The `pwd-reset:` prefix is
//   reserved for password resets in /api/auth/forgot-password.
//
// Token TTL: 24 hours (longer than password resets because users may not
// open the email immediately).
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, verificationTokens } from "@repo/db";
import { createEmailSender, emailVerificationHtml } from "@repo/infrastructure/email";

export const EMAIL_VERIFY_PREFIX = "email-verify:";
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

const emailSender = createEmailSender();

/**
 * Build the absolute URL the user clicks to confirm their email.
 * Falls back to the request origin if no public URL is configured — useful
 * in dev / preview deployments.
 */
export function buildVerifyUrl(req: Request, token: string): string {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    new URL(req.url).origin;
  return `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
}

/**
 * Issue a fresh email-verification token for the given user, persist it in
 * verification_tokens (replacing any prior token for the same email), and
 * send the verification email.
 *
 * Returns the issued token so callers can log/test it. Sending failures are
 * logged but do not throw — the caller decides how to surface them.
 */
export async function issueAndSendVerificationToken(opts: {
  userEmail: string;
  emailNormalized: string;
  displayName: string;
  req: Request;
}): Promise<string> {
  const identifier = `${EMAIL_VERIFY_PREFIX}${opts.emailNormalized}`;
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);

  // Replace any existing token row for this identifier so older links
  // become invalid the moment a new one is issued.
  await (db as any)
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, identifier));

  await (db as any).insert(verificationTokens).values({
    identifier,
    token,
    expires,
  });

  const url = buildVerifyUrl(opts.req, token);

  try {
    await emailSender.send({
      to: opts.userEmail,
      subject: "تأیید ایمیل Trello OS",
      html: emailVerificationHtml(url, opts.displayName),
      text: `برای فعال‌سازی حساب، به این لینک بروید:\n${url}\n(تا ۲۴ ساعت معتبر است)`,
    });
  } catch (err) {
    console.error("[verify-email] dispatch failed", err);
  }

  return token;
}
