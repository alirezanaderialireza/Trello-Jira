// packages/db/src/repositories/workspaceInvitations.repository.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// DrizzleWorkspaceInvitationsRepository
//
// Concrete repository for the token-based workspace invitation flow. No
// domain port in F1 (per D4) — the flow's use cases (issue, accept, revoke,
// cleanup-expired) and Zod validators land in F2/F3.
//
// Tenant scope is enforced by RLS:
//   • SELECT — admin/owner of the workspace, the invited user_id, or a user
//              whose normalized email matches a still-pending invitation.
//   • INSERT/UPDATE/DELETE — admin/owner only.
// Callers therefore MUST run inside `withTenantContext(tenantId, userId)`.
// The accept-by-token endpoint is the single exception: it runs as a
// BYPASSRLS service role because the user is not yet a member at accept
// time (see F3 router for that flow; this repository's `findByToken`
// returns the row regardless of RLS when called via app_service).
//
// Tokens are crypto-random 64-char base64url strings (≥384 bits of
// entropy). Collision is statistically impossible, but we still retry up
// to three times on a unique-violation against the token index — defensive
// against an unforeseen entropy regression in `crypto.randomBytes`. The
// retry is constrained to the token constraint specifically; a violation
// against the (lower(invited_email), workspace_id) partial unique surfaces
// to the caller as a duplicate-active-invitation error.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { workspaceInvitations } from "../schema";
import type {
  WorkspaceInvitation,
  WorkspaceInvitationRole,
} from "../schema/workspaceInvitations";

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Thrown when an active invitation already exists for
 * (lower(invited_email), workspace_id).
 *
 * The router translates this to a CONFLICT response with a Persian message
 * for the UI. Keep the constructor stable — F3 tests will assert on the
 * `.name` property.
 */
export class DuplicateActiveInvitationError extends Error {
  constructor(email: string, workspaceId: string) {
    super(`DUPLICATE_ACTIVE_INVITATION: ${email} -> ${workspaceId}`);
    this.name = "DuplicateActiveInvitationError";
  }
}

/** Defensive — three retries on token collision should never trigger. */
export class TokenGenerationExhaustedError extends Error {
  constructor() {
    super("INVITATION_TOKEN_GENERATION_EXHAUSTED");
    this.name = "TokenGenerationExhaustedError";
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * 48 random bytes → 64-char base64url string.
 *
 *   384 bits of entropy.  Collision probability ≈ 0 even at planetary
 *   scale (a billion concurrent invitations would still take longer than
 *   the age of the universe to collide on average).
 */
function generateInvitationToken(): string {
  return randomBytes(48).toString("base64url");
}

interface PgUniqueViolation {
  code: string;
  constraint?: string;
}

function isUniqueViolation(err: unknown): err is PgUniqueViolation {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as PgUniqueViolation).code === "23505"
  );
}

// ─── Repository ──────────────────────────────────────────────────────────────

const TOKEN_INDEX = "idx_invitations_token_unique";
const ACTIVE_EMAIL_WS_INDEX = "idx_invitations_active_email_workspace_unique";
const DEFAULT_EXPIRES_IN_DAYS = 7;
const MAX_TOKEN_RETRIES = 3;

export class DrizzleWorkspaceInvitationsRepository {
  constructor(private readonly db: any) {}

  // ──────────────────────────────────────────────────────────────────────────
  // create — issue a new invitation. Generates the token here so callers
  // never have to think about format or collision retry. Throws
  // DuplicateActiveInvitationError if an active invitation already exists
  // for the same (email, workspace).
  // ──────────────────────────────────────────────────────────────────────────

  async create(
    args: {
      workspaceId: string;
      email: string;
      role: WorkspaceInvitationRole;
      invitedByUserId: string;
      invitedUserId?: string | null;
      expiresInDays?: number;
    },
    tx?: any,
  ): Promise<WorkspaceInvitation> {
    const db = tx ?? this.db;
    const expiresInDays = args.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS;
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);
    const normalizedEmail = args.email.trim().toLowerCase();

    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
      const token = generateInvitationToken();
      try {
        const rows = await db
          .insert(workspaceInvitations)
          .values({
            // tenant_id == workspace_id invariant (CHECK enforces it).
            tenantId: args.workspaceId,
            workspaceId: args.workspaceId,
            invitedEmail: normalizedEmail,
            invitedUserId: args.invitedUserId ?? null,
            invitedByUserId: args.invitedByUserId,
            role: args.role,
            token,
            expiresAt,
          })
          .returning();
        return rows[0] as WorkspaceInvitation;
      } catch (err) {
        lastErr = err;
        if (!isUniqueViolation(err)) throw err;
        if (err.constraint === ACTIVE_EMAIL_WS_INDEX) {
          throw new DuplicateActiveInvitationError(
            normalizedEmail,
            args.workspaceId,
          );
        }
        if (err.constraint === TOKEN_INDEX) {
          // statistically impossible — retry with a fresh token
          continue;
        }
        throw err;
      }
    }
    // All retries hit a token collision, which is essentially impossible.
    // Surface a distinct error so observability spots the entropy bug.
    throw new TokenGenerationExhaustedError();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // findByToken — single row by unique token. Returns null if not found,
  // expired, accepted, or revoked. The router uses this on the accept page
  // and is responsible for distinguishing between "never existed" and
  // "no longer valid" via separate UI states.
  //
  // CALLER MUST be a BYPASSRLS connection (app_service) for the accept
  // flow — at accept time the user is not yet a member, so the SELECT RLS
  // policy would hide the row. F3 routes this through a dedicated tRPC
  // procedure that uses the service role.
  // ──────────────────────────────────────────────────────────────────────────

  async findByToken(token: string): Promise<WorkspaceInvitation | null> {
    const rows = await this.db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.token, token))
      .limit(1);
    return rows[0] ?? null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // findActiveByWorkspace — pending (not accepted, not revoked, not
  // expired) invitations of a workspace. Used by Members tab → Pending
  // invitations section.
  // ──────────────────────────────────────────────────────────────────────────

  async findActiveByWorkspace(
    workspaceId: string,
  ): Promise<WorkspaceInvitation[]> {
    return await this.db
      .select()
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, workspaceId),
          isNull(workspaceInvitations.acceptedAt),
          isNull(workspaceInvitations.revokedAt),
          sql`${workspaceInvitations.expiresAt} > now()`,
        ),
      );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // findActiveByEmail — cross-workspace pending invitations for a given
  // email. Used at login to surface "you have N pending invitations" in
  // the notifications bell.
  // ──────────────────────────────────────────────────────────────────────────

  async findActiveByEmail(email: string): Promise<WorkspaceInvitation[]> {
    const normalized = email.trim().toLowerCase();
    return await this.db
      .select()
      .from(workspaceInvitations)
      .where(
        and(
          sql`lower(${workspaceInvitations.invitedEmail}) = ${normalized}`,
          isNull(workspaceInvitations.acceptedAt),
          isNull(workspaceInvitations.revokedAt),
          sql`${workspaceInvitations.expiresAt} > now()`,
        ),
      );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // revoke — soft-revocation. Sets revoked_at + revoked_by, never DELETEs.
  // Idempotent: a revoke on an already-revoked row updates `revoked_at`
  // again; a revoke on an accepted row is rejected by the lifecycle CHECK
  // (`NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)`).
  // ──────────────────────────────────────────────────────────────────────────

  async revoke(
    invitationId: string,
    revokedByUserId: string,
    tx?: any,
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(workspaceInvitations)
      .set({
        revokedAt: new Date(),
        revokedByUserId,
      })
      .where(
        and(
          eq(workspaceInvitations.id, invitationId),
          isNull(workspaceInvitations.acceptedAt),
        ),
      );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // markAccepted — flip an invitation from pending to accepted. The actual
  // membership row is created by the caller in the same transaction
  // (F3 use case), so this method is intentionally narrow.
  //
  // The WHERE clause excludes already-revoked rows; the lifecycle CHECK
  // backs that up at the DB level.
  // ──────────────────────────────────────────────────────────────────────────

  async markAccepted(
    invitationId: string,
    acceptedByUserId: string,
    tx?: any,
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(workspaceInvitations)
      .set({
        acceptedAt: new Date(),
        acceptedByUserId,
      })
      .where(
        and(
          eq(workspaceInvitations.id, invitationId),
          isNull(workspaceInvitations.acceptedAt),
          isNull(workspaceInvitations.revokedAt),
        ),
      );
  }
}
