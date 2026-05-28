// apps/outbox-worker/src/handlers/workspaceInvitationCreated.handler.ts
//
// Handler for the `workspace.invitation.created` outbox event.
// Looks up the invitation token + workspace name + inviter name,
// renders the Persian RTL invitation email template, and hands the
// result to the configured email sender.
//
// ─── RLS context ─────────────────────────────────────────────────────────────
// Pre-flight verified that `workspaces`, `workspace_invitations`, and
// `users` are NOT under ROW LEVEL SECURITY (only the board-related
// tables enable RLS — see migration 0002_phase02_auth_rls.sql). So
// the handler executes plain queries without `SET LOCAL
// app.current_tenant_id`. If a future migration enables RLS on any
// of these tables, this handler will break with empty result sets;
// the integration test for accepting an invitation will fail loudly.
//
// ─── Idempotency ─────────────────────────────────────────────────────────────
// At-least-once delivery is the contract of the outbox worker. If
// the email send fails AFTER the Redis publish succeeds, the row
// stays unprocessed and the next poll re-publishes + re-invokes this
// handler — the recipient may receive the email twice. Acceptable
// for F5a; the outbox event uses correlationId = idempotencyKey to
// prevent server-side double-create, but the email step itself is
// not yet idempotent.
//
//   TODO(post-F5a): add `email_sent_at` column on
//   `workspace_invitations` (or `outbox_events.metadata`) and skip
//   send when already set. Requires a migration so it ships with
//   the soft-delete email handler PR.

import { sql } from "drizzle-orm";

import {
  createEmailSender,
  workspaceInvitationHtml,
  workspaceInvitationSubject,
  workspaceInvitationText,
  type EmailSender,
} from "@repo/infrastructure/email";

import type { EventHandler } from "../types";

// ── Module-level singletons ──────────────────────────────────────────────────
//
// `createEmailSender()` is cheap (it just inspects env), but doing
// it once at module load matches the pattern used elsewhere and
// keeps per-event work allocation-free.

const emailSender: EmailSender = createEmailSender();

// ── Constants ────────────────────────────────────────────────────────────────

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const ROLE_LABELS: Record<string, string> = {
  OWNER: "مالک",
  ADMIN: "مدیر",
  MEMBER: "عضو",
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role.toUpperCase()] ?? role;
}

/**
 * Persian (Jalali) calendar formatting using ICU.
 *
 * `fa-IR-u-ca-persian` explicitly opts into the Persian calendar via
 * the Unicode `-u-ca-` extension; without it Node's default Persian
 * locale uses Gregorian month names with Persian numerals, which is
 * jarring in user-facing copy.
 */
function formatPersianDateTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString("fa-IR-u-ca-persian", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    // Defensive: malformed ISO string. Return the raw value so the
    // email still renders something readable for the recipient.
    return isoString;
  }
}

// ── Payload shape (mirrors invitations.router.ts emit) ───────────────────────

interface InvitationCreatedPayload {
  workspaceId: string;
  invitationId: string;
  invitedEmail: string;
  role: string;
  invitedBy: string;
  expiresAt: string;
}

interface InvitationLookupRow {
  token: string;
  workspace_name: string;
  inviter_name: string;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export const workspaceInvitationCreatedHandler: EventHandler = async (ctx) => {
  const payload = ctx.event.payload as unknown as InvitationCreatedPayload;

  // Type-narrow the opaque tx (see types.ts comment) to the drizzle
  // surface we actually use here: `execute(sql\`...\`)`.
  const tx = ctx.tx as {
    execute: (
      query: ReturnType<typeof sql>,
    ) => Promise<readonly InvitationLookupRow[]>;
  };

  // Single round-trip JOIN to fetch every value the email template
  // needs. The invitation row itself owns the token; workspaces +
  // users are joined by id from the payload.
  const rows = await tx.execute(sql`
    SELECT
      wi.token              AS token,
      w.name                AS workspace_name,
      u.display_name        AS inviter_name
    FROM workspace_invitations wi
    JOIN workspaces w ON w.id = wi.workspace_id
    JOIN users      u ON u.id = ${payload.invitedBy}
    WHERE wi.id = ${payload.invitationId}
    LIMIT 1
  `);

  const row = rows[0];
  if (!row) {
    // Either the invitation was revoked between create + email-send,
    // or the inviter / workspace was deleted in the same window. We
    // throw so the outbox marks the event for retry; if it persists
    // through MAX_RETRIES the row goes to the DLQ and a follow-up
    // human can decide whether to resend manually.
    throw new Error(
      `[invitationCreated] lookup failed for invitationId=${payload.invitationId}`,
    );
  }

  const acceptUrl = `${APP_BASE_URL}/invitations/${encodeURIComponent(row.token)}`;
  const expiresAtFormatted = formatPersianDateTime(payload.expiresAt);

  const templateParams = {
    workspaceName: row.workspace_name,
    inviterName: row.inviter_name,
    roleLabel: roleLabel(payload.role),
    acceptUrl,
    expiresAtFormatted,
  };

  const result = await emailSender.send({
    to: payload.invitedEmail,
    subject: workspaceInvitationSubject({ workspaceName: row.workspace_name }),
    html: workspaceInvitationHtml(templateParams),
    text: workspaceInvitationText(templateParams),
  });

  if (!result.success) {
    // Bubble up so the outbox worker logs + retries.
    throw new Error(
      `[invitationCreated] email send failed for invitationId=${payload.invitationId}`,
    );
  }
};
