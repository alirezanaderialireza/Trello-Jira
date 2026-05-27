// packages/api/src/routers/userBoardMetadata.router.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// User-Board metadata router (F3b).
//
// Per-(user, board) sidebar bookkeeping: starred boards and recently-
// viewed boards. These are user-private signals — visible only to the
// user who created them — so they intentionally do NOT participate in
// the outbox/realtime fanout (D12 from F3b plan: silent). Cross-tab sync
// for the same user happens client-side via BroadcastChannel in F4.
//
// Tenant context:
//   `user_board_metadata` rows carry `tenant_id` so RLS can scope them
//   alongside boards. The router resolves `tenant_id` from the parent
//   board (a board never moves tenants) before calling upsert/recordView.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";

import { router, protectedProcedure } from "../trpc";
import { boardMemberProcedure } from "../middleware/boardRoleProcedures";
import { DrizzleUserBoardMetadataRepository } from "@repo/db";
import { boards } from "@repo/db";

// ─── Schemas ────────────────────────────────────────────────────────────────

const BoardIdSchema = z.string().uuid();
const RecentLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(20)
  .default(5);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve `tenant_id` for a board the caller already has membership on.
 * boardMemberProcedure validated active membership before this runs, so
 * we trust ctx.boardMembership.boardId and only need the tenantId.
 *
 * Throws NOT_FOUND if the board has been soft-deleted between the
 * membership lookup and this query (rare race; leaves the user with a
 * clean error message).
 */
async function resolveBoardTenant(ctx: any, boardId: string): Promise<string> {
  const board = await ctx.infra.db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), isNull(boards.deletedAt)),
  });
  if (!board) {
    throw new TRPCError({ code: "NOT_FOUND", message: "بورد یافت نشد." });
  }
  return board.tenantId;
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const userBoardMetadataRouter = router({
  // ── toggleStar (board member) ────────────────────────────────────────────
  //
  // Flips is_starred for the (user, board) row. Upsert: creates the row
  // on first call. Returns the new state so the client can confirm
  // optimistic update.
  toggleStar: boardMemberProcedure
    .input(z.object({ boardId: BoardIdSchema }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = await resolveBoardTenant(ctx, input.boardId);
      const repo = new DrizzleUserBoardMetadataRepository(ctx.infra.db);

      // Read the current state so we can compute the toggled value AND
      // return the new state. The repo's findByUserAndBoard returns null
      // for first-time call → treat as not-starred.
      const current = await repo.findByUserAndBoard(
        ctx.session.user.id,
        input.boardId,
      );
      const nextIsStarred = !(current?.isStarred ?? false);

      await repo.upsertStar(
        {
          userId: ctx.session.user.id,
          boardId: input.boardId,
          tenantId,
          isStarred: nextIsStarred,
        },
        ctx.infra.db,
      );

      return { boardId: input.boardId, isStarred: nextIsStarred };
    }),

  // ── recordView (board member, fire-and-forget) ──────────────────────────
  //
  // Sets last_viewed_at = now() on the (user, board) row. Idempotent —
  // safe to call from BoardLayout's mount effect.
  recordView: boardMemberProcedure
    .input(z.object({ boardId: BoardIdSchema }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = await resolveBoardTenant(ctx, input.boardId);
      const repo = new DrizzleUserBoardMetadataRepository(ctx.infra.db);

      await repo.recordView(
        {
          userId: ctx.session.user.id,
          boardId: input.boardId,
          tenantId,
        },
        ctx.infra.db,
      );

      return { success: true };
    }),

  // ── getStarred (any logged-in user) ──────────────────────────────────────
  //
  // Cross-workspace: returns every starred board the user can see. RLS
  // and the repository's notDeleted joins handle the visibility rules
  // (workspace not soft-deleted, board not soft-deleted, D8 cascade).
  getStarred: protectedProcedure.query(async ({ ctx }) => {
    const repo = new DrizzleUserBoardMetadataRepository(ctx.infra.db);
    return await repo.listStarred(ctx.session.user.id);
  }),

  // ── getRecent (any logged-in user) ───────────────────────────────────────
  //
  // Top-N most recently viewed boards (default 5). Same visibility
  // rules as getStarred.
  getRecent: protectedProcedure
    .input(
      z
        .object({
          limit: RecentLimitSchema,
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const repo = new DrizzleUserBoardMetadataRepository(ctx.infra.db);
      return await repo.listRecent(ctx.session.user.id, input?.limit ?? 5);
    }),
});
