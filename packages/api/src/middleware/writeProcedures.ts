// packages/api/src/middleware/writeProcedures.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Two convenience write builders for F3 routers:
//
//   workspaceAdminWriteProcedure — workspaceAdmin + workspace lifecycle
//                                  (rejects writes against soft-deleted
//                                  workspaces).
//
//   boardAdminWriteProcedure     — boardAdmin + board lifecycle (rejects
//                                  writes against soft-deleted boards;
//                                  rejects writes against archived boards
//                                  unless `allowArchived: true` is supplied
//                                  via the `makeBoardAdminWriteProcedure`
//                                  factory — used exclusively for unarchive).
//
// Why a separate file from the role procedures? Because the role check is
// always-required and cheap; the lifecycle check is a write-only concern
// and adds an extra DB read. A pure read procedure should not pay for it.
// Keeping them in their own file makes the contract obvious.
//
// D2 (F2 plan): writes against archived boards are REJECTED by default.
// The single legitimate exception is `unarchive(boardId)`, which has to
// operate on an archived board by definition. That router uses
// `makeBoardAdminWriteProcedure({ allowArchived: true })` directly.
// ─────────────────────────────────────────────────────────────────────────────

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { boards, workspaces } from "@repo/db";

import { workspaceAdminProcedure } from "./workspaceRoleProcedures";
import { boardAdminProcedure } from "./boardRoleProcedures";

// ─── Internal helpers (exported for tests) ──────────────────────────────────

/** Minimal board lifecycle shape. */
interface BoardLifecycle {
  archivedAt: Date | null;
  deletedAt: Date | null;
}

/** Minimal workspace lifecycle shape. */
interface WorkspaceLifecycle {
  deletedAt: Date | null;
}

/**
 * Throws if the workspace is missing (board's row not found) or
 * soft-deleted. Pure function — no I/O.
 */
export function assertWorkspaceWritable(
  ws: WorkspaceLifecycle | null | undefined,
): void {
  if (!ws) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "فضای کاری یافت نشد.",
    });
  }
  if (ws.deletedAt) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "فضای کاری یافت نشد.",
    });
  }
}

/**
 * Throws if the board is missing, soft-deleted, OR archived (unless
 * `allowArchived: true`). Pure function — no I/O.
 */
export function assertBoardWritable(
  board: BoardLifecycle | null | undefined,
  opts: { allowArchived?: boolean } = {},
): void {
  if (!board) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "بورد یافت نشد.",
    });
  }
  if (board.deletedAt) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "بورد یافت نشد.",
    });
  }
  if (!opts.allowArchived && board.archivedAt) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "این بورد آرشیو شده است؛ ابتدا از حالت آرشیو خارج کنید.",
    });
  }
}

// ─── Builders ───────────────────────────────────────────────────────────────

export const workspaceAdminWriteProcedure = workspaceAdminProcedure.use(
  async ({ ctx, next }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workspaceId = (ctx as any).workspaceMembership.workspaceId as string;
    const ws = await ctx.infra.db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });
    assertWorkspaceWritable(ws);
    return next();
  },
);

/**
 * Factory for board-admin-write procedures with optional archived
 * override. The default export `boardAdminWriteProcedure` is
 * `makeBoardAdminWriteProcedure()` (i.e. archived rejected). Routers
 * that need to operate on archived boards specifically (only unarchive,
 * really) should call the factory with `{ allowArchived: true }`:
 *
 *     export const unarchive = makeBoardAdminWriteProcedure({
 *       allowArchived: true,
 *     }).input(...).mutation(async ({ ctx, input }) => { ... });
 */
export function makeBoardAdminWriteProcedure(
  opts: { allowArchived?: boolean } = {},
) {
  return boardAdminProcedure.use(async ({ ctx, next }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const boardId = (ctx as any).boardMembership.boardId as string;
    const board = await ctx.infra.db.query.boards.findFirst({
      where: eq(boards.id, boardId),
    });
    assertBoardWritable(board, opts);
    return next();
  });
}

/**
 * Default board-admin write procedure — REJECTS writes against archived
 * boards. Use this for every board mutation EXCEPT unarchive().
 */
export const boardAdminWriteProcedure = makeBoardAdminWriteProcedure();
