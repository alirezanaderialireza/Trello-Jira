// packages/db/src/repositories/userBoardMetadata.repository.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// DrizzleUserBoardMetadataRepository
//
// Per-(user, board) sidebar bookkeeping. No domain port in F1 (per D4) —
// the use cases that consume it land in F3 along with the tRPC router.
//
// All methods are tenant-scoped at the RLS layer (FORCE row level security
// + `app.current_user_id()` + `current_tenant_id()` predicates), so callers
// must run them inside `withTenantContext(...)`. The repository itself does
// not append additional `tenant_id = ?` filters — that would be redundant
// with RLS and would hide bugs where the GUC is missing (RLS would correctly
// return zero rows; an extra app-level filter would mask the missing GUC
// behind a stale-feeling sidebar instead of a clear "I see nothing" signal).
// ─────────────────────────────────────────────────────────────────────────────

import { and, desc, eq } from "drizzle-orm";
import { boards, userBoardMetadata, workspaces } from "../schema";
import type {
  UserBoardMetadata,
} from "../schema/userBoardMetadata";
import { notDeleted } from "../lib/softDeleteFilter";

// ─── Public listing row shapes ──────────────────────────────────────────────
//
// Sidebar surfaces don't want a bare metadata row — they want the board
// joined in so the link can render (workspace slug, board title, …). Keep
// the join shape minimal here; the router selects exactly what the sidebar
// needs.

export interface SidebarBoardLink {
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  /** ISO-string at the application layer; the column is timestamptz. */
  lastViewedAt: Date | null;
  isStarred: boolean;
}

// ─── Repository ──────────────────────────────────────────────────────────────

export class DrizzleUserBoardMetadataRepository {
  // The repository deliberately uses `any` for the db handle — the real
  // Drizzle types are deeply generic and pull node_modules into every
  // consumer's typecheck graph. Every other repository in this package
  // does the same.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly db: any) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Star / Unstar — upsert by composite PK (user_id, board_id).
  //
  // `tenantId` is required by the caller because the row lives outside any
  // single board scope and the RLS policy needs a non-null `tenant_id` to
  // accept the INSERT. The router resolves it from `boards.tenant_id`
  // before calling here.
  // ──────────────────────────────────────────────────────────────────────────

  async upsertStar(
    args: {
      userId: string;
      boardId: string;
      tenantId: string;
      isStarred: boolean;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<void> {
    const db = tx ?? this.db;
    const now = new Date();
    await db
      .insert(userBoardMetadata)
      .values({
        userId: args.userId,
        boardId: args.boardId,
        tenantId: args.tenantId,
        isStarred: args.isStarred,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userBoardMetadata.userId, userBoardMetadata.boardId],
        set: {
          isStarred: args.isStarred,
          updatedAt: now,
        },
      });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Record a board view — set last_viewed_at = now() (upsert).
  //
  // Idempotent: same (user, board) called twice in 100ms produces one row,
  // last_viewed_at advances to the second now(). The router debounces
  // calls; here we just make the write fast.
  // ──────────────────────────────────────────────────────────────────────────

  async recordView(
    args: {
      userId: string;
      boardId: string;
      tenantId: string;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<void> {
    const db = tx ?? this.db;
    const now = new Date();
    await db
      .insert(userBoardMetadata)
      .values({
        userId: args.userId,
        boardId: args.boardId,
        tenantId: args.tenantId,
        lastViewedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userBoardMetadata.userId, userBoardMetadata.boardId],
        set: {
          lastViewedAt: now,
          updatedAt: now,
        },
      });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Sidebar "Starred" — every starred board for the user, scoped by RLS to
  // the current tenant. JOINs to `boards` and `workspaces` and filters out
  // deleted/archived boards plus deleted workspaces (D8).
  // ──────────────────────────────────────────────────────────────────────────

  async listStarred(userId: string): Promise<SidebarBoardLink[]> {
    const rows = await this.db
      .select({
        boardId: boards.id,
        boardTitle: boards.title,
        workspaceId: boards.tenantId,
        lastViewedAt: userBoardMetadata.lastViewedAt,
        isStarred: userBoardMetadata.isStarred,
      })
      .from(userBoardMetadata)
      .innerJoin(boards, eq(boards.id, userBoardMetadata.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.tenantId))
      .where(
        and(
          eq(userBoardMetadata.userId, userId),
          eq(userBoardMetadata.isStarred, true),
          notDeleted(boards),
          notDeleted(workspaces),
        ),
      );
    return rows;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Sidebar "Recent" — top-N most recently viewed boards.
  // Default N=5 (Trello-faithful).
  // ──────────────────────────────────────────────────────────────────────────

  async listRecent(userId: string, limit = 5): Promise<SidebarBoardLink[]> {
    const rows = await this.db
      .select({
        boardId: boards.id,
        boardTitle: boards.title,
        workspaceId: boards.tenantId,
        lastViewedAt: userBoardMetadata.lastViewedAt,
        isStarred: userBoardMetadata.isStarred,
      })
      .from(userBoardMetadata)
      .innerJoin(boards, eq(boards.id, userBoardMetadata.boardId))
      .innerJoin(workspaces, eq(workspaces.id, boards.tenantId))
      .where(
        and(
          eq(userBoardMetadata.userId, userId),
          notDeleted(boards),
          notDeleted(workspaces),
        ),
      )
      .orderBy(desc(userBoardMetadata.lastViewedAt))
      .limit(limit);
    return rows;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Direct row read by composite PK — used by the router when it needs to
  // diff old/new state for an event payload.
  // ──────────────────────────────────────────────────────────────────────────

  async findByUserAndBoard(
    userId: string,
    boardId: string,
  ): Promise<UserBoardMetadata | null> {
    const rows = await this.db
      .select()
      .from(userBoardMetadata)
      .where(
        and(
          eq(userBoardMetadata.userId, userId),
          eq(userBoardMetadata.boardId, boardId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
