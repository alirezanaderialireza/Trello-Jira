// packages/api/src/routers/board-management.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Board lifecycle router (F3b refactor).
//
// F3b changes:
//   • Three pre-existing procedures (archiveBoard / unarchiveBoard /
//     deleteBoard) are migrated from the legacy `assertBoardAdmin` helper
//     to the F2 role + lifecycle procedure builders. The pre-F3b
//     procedures performed the role check inline AND queried `boards` a
//     second time to resolve the row — the F2 builders fold both checks
//     into the procedure pipeline (load membership, assert role, load
//     board, assert lifecycle).
//   • Three new procedures: restoreBoard / setBackground /
//     updateVisibility, completing the lifecycle parity with workspaces.
//   • Every mutation now emits an outbox event in the same RLS-enforced
//     transaction as the write, so downstream subscribers (audit,
//     realtime, sidebar invalidator) receive the change atomically.
//   • Every mutation accepts an optional `idempotencyKey` and is wrapped
//     in `withIdempotency()` for replay safety.
//   • Redundant `eq(boards.tenantId, ctx.session.tenantId)` filters are
//     removed: tenantContextMiddleware sets the RLS GUC so the database
//     enforces the same boundary, and the F2 builder already loaded a
//     tenant-scoped board into the procedure pipeline.
//
// Procedures preserved unchanged (out of F3b scope):
//   • getBoardsByUser — read path, F2 builders are write-oriented; the
//     existing inline membership scan is fine. Will land in F3c when the
//     "list boards in workspace" path is unified.
//   • createBoard — no boardId yet at call time, so F2 board builders
//     don't apply. Stays as `protectedProcedure`. Refactor with workspace
//     scope is a separate concern (F3c).
//   • renameBoard — kept on the legacy assertBoardAdmin helper for now.
//     Refactor in F3c alongside the workspace.update parity, when a
//     `board.renamed` outbox event is also added.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull, desc } from "drizzle-orm";

import { router, protectedProcedure } from "../trpc";
import {
  boardAdminWriteProcedure,
  makeBoardAdminWriteProcedure,
} from "../middleware/writeProcedures";
import {
  boardAdminProcedure,
  boardMemberProcedure,
} from "../middleware/boardRoleProcedures";
import { withIdempotency } from "../utils/idempotency";
import { boards, boardMembers } from "@repo/db";
import type { BoardId } from "@repo/domain";

// ─── Shared schemas ─────────────────────────────────────────────────────────

const BoardIdSchema = z.string().uuid();
const TitleSchema = z.string().trim().min(1).max(128);
const IdempotencyKeySchema = z.string().uuid().optional();

const VisibilitySchema = z.enum(["workspace", "private", "public"]);

/**
 * Free-form JSONB shape for board background. Matches the workspace
 * setBackground convention (no `.strict()` — the UI evolves background
 * presets without a schema bump). The DB-level CHECK constrains the
 * column to a JSON object; nullable.
 */
const BackgroundDataSchema = z.record(z.string(), z.unknown()).nullable();

// ─── Legacy helper (kept for getBoardsByUser, createBoard, renameBoard) ─────
//
// New procedures use F2 builders. This stays only for the three procedures
// that are explicitly out of F3b scope (see header comment).

async function assertBoardAdminLegacy(ctx: any, boardId: string) {
  const membership = await ctx.infra.db.query.boardMembers.findFirst({
    where: and(
      eq(boardMembers.boardId, boardId),
      eq(boardMembers.userId, ctx.session.user.id),
      isNull(boardMembers.removedAt),
    ),
  });
  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND", message: "بورد یافت نشد." });
  }
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "این عملیات فقط برای مدیر یا مالک بورد مجاز است.",
    });
  }
  return membership;
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const boardManagementRouter = router({
  // ════════════════════════════════════════════════════════════════════════
  // PRE-F3b — preserved unchanged
  // ════════════════════════════════════════════════════════════════════════

  // ── getBoardsByUser ──────────────────────────────────────────────────────
  getBoardsByUser: protectedProcedure
    .input(
      z
        .object({
          cursor: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(50).default(20),
          includeArchived: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 20;
      const includeArchived = input?.includeArchived ?? false;

      const memberships = await ctx.infra.db.query.boardMembers.findMany({
        where: and(
          eq(boardMembers.userId, ctx.session.user.id),
          isNull(boardMembers.removedAt),
        ),
        orderBy: [desc(boardMembers.createdAt)],
      });

      if (memberships.length === 0) {
        return { boards: [], nextCursor: undefined };
      }

      const boardIds = memberships.map((m: any) => m.boardId);
      const roleMap = new Map(memberships.map((m: any) => [m.boardId, m.role]));

      const allBoards = await ctx.infra.db
        .select()
        .from(boards)
        .where(isNull(boards.deletedAt))
        .orderBy(desc(boards.updatedAt));

      let filtered = allBoards.filter((b: any) => boardIds.includes(b.id));
      if (!includeArchived) {
        filtered = filtered.filter((b: any) => !b.archivedAt);
      }

      let startIdx = 0;
      if (input?.cursor) {
        const cursorIdx = filtered.findIndex((b: any) => b.id === input.cursor);
        if (cursorIdx !== -1) startIdx = cursorIdx + 1;
      }

      const page = filtered.slice(startIdx, startIdx + limit);
      const nextCursor = page.length === limit ? page[page.length - 1]?.id : undefined;

      return {
        boards: page.map((b: any) => ({
          id: b.id,
          title: b.title,
          role: roleMap.get(b.id) ?? "MEMBER",
          archivedAt: b.archivedAt?.toISOString() ?? null,
          createdAt: b.createdAt.toISOString(),
          updatedAt: b.updatedAt.toISOString(),
        })),
        nextCursor,
      };
    }),

  // ── getBoardSettings (any active member) ─────────────────────────────────
  //
  // F5b — single-board metadata read for the board settings drawer.
  //
  // Returns the fields the drawer needs to render initial state for its
  // tabs:
  //   • title          (About tab pre-fill)
  //   • description    (About tab — currently read-only; the editor lands
  //                     in F1.2 once renameBoard grows a description input
  //                     or a dedicated procedure replaces it)
  //   • visibility     (Permissions tab radio pre-selection)
  //   • backgroundData (Background tab swatch highlight)
  //   • archivedAt     (Danger tab — reveals the soft-delete section only
  //                     when archived)
  //   • role           (per-tab capability gates inside the drawer)
  //
  // Authorization is `boardMemberProcedure` (read access for any active
  // member). Settings is OWNER+ADMIN only at the UI level, but a MEMBER
  // hitting this endpoint directly still gets the data — that's
  // intentional: the drawer's role gate lives on the client and a MEMBER
  // who URL-hacks just sees a read-only view.
  //
  // Lifecycle:
  //   • Soft-deleted boards are NOT returned (NOT_FOUND). The drawer is
  //     unreachable for a soft-deleted board because the page itself
  //     bails earlier; this is defence-in-depth.
  //   • Archived boards ARE returned — the drawer needs to show the
  //     "بازگردانی" CTA on archived boards.
  getBoardSettings: boardMemberProcedure
    .input(z.object({ boardId: BoardIdSchema }))
    .query(async ({ input, ctx }) => {
      const board = await ctx.infra.db.query.boards.findFirst({
        where: and(eq(boards.id, input.boardId), isNull(boards.deletedAt)),
      });
      if (!board) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "بورد یافت نشد.",
        });
      }

      // The boardMemberGuard middleware loaded ctx.boardMembership;
      // we just surface the role to the client so the drawer can gate
      // its tabs.
      const role = (ctx as any).boardMembership?.role as
        | "OWNER"
        | "ADMIN"
        | "MEMBER"
        | undefined;

      return {
        id: board.id,
        title: board.title,
        description: board.description ?? null,
        visibility: board.visibility as "workspace" | "private" | "public",
        backgroundData: board.backgroundData,
        archivedAt: board.archivedAt?.toISOString() ?? null,
        role: role ?? "MEMBER",
      };
    }),

  // ── createBoard (no boardId in input — F2 builders don't apply) ──────────
  createBoard: protectedProcedure
    .input(z.object({ title: TitleSchema }))
    .mutation(async ({ input, ctx }) => {
      const boardId = crypto.randomUUID();
      const now = new Date();

      await ctx.infra.db.insert(boards).values({
        id: boardId,
        tenantId: ctx.session.tenantId,
        title: input.title,
        revision: 1,
        aclVersion: 1,
        currentSequence: 0,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.infra.db.insert(boardMembers).values({
        id: crypto.randomUUID(),
        tenantId: ctx.session.tenantId,
        boardId,
        userId: ctx.session.user.id,
        role: "OWNER",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });

      ctx.infra.logger.info({
        event: "board_created",
        boardId,
        userId: ctx.session.user.id,
        tenantId: ctx.session.tenantId,
      });

      return { id: boardId, title: input.title };
    }),

  // ── renameBoard (legacy — F3c will refactor + add outbox) ────────────────
  renameBoard: protectedProcedure
    .input(z.object({ boardId: BoardIdSchema, title: TitleSchema }))
    .mutation(async ({ input, ctx }) => {
      await assertBoardAdminLegacy(ctx, input.boardId);

      const board = await ctx.infra.db.query.boards.findFirst({
        where: and(eq(boards.id, input.boardId), isNull(boards.deletedAt)),
      });
      if (!board) {
        throw new TRPCError({ code: "NOT_FOUND", message: "بورد یافت نشد." });
      }

      await ctx.infra.db
        .update(boards)
        .set({ title: input.title, updatedAt: new Date() })
        .where(eq(boards.id, input.boardId));

      ctx.infra.logger.info({
        event: "board_renamed",
        boardId: input.boardId,
        oldTitle: board.title,
        newTitle: input.title,
        userId: ctx.session.user.id,
      });

      return { success: true };
    }),

  // ════════════════════════════════════════════════════════════════════════
  // F3b — refactored existing procedures (archive / unarchive / delete)
  //       + new procedures (restore / setBackground / updateVisibility)
  // ════════════════════════════════════════════════════════════════════════

  // ── archiveBoard (refactored) ────────────────────────────────────────────
  //
  // F2 boardAdminWriteProcedure rejects writes against archived boards by
  // default — but archive *is* the operation that creates that state, so
  // the source board must itself be NOT archived. The default builder is
  // therefore correct here (rejects re-archive of already-archived).
  archiveBoard: boardAdminWriteProcedure
    .input(
      z.object({
        boardId: BoardIdSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        await ctx.repos.board.archive(input.boardId as BoardId, ctx.infra.db);

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.boardId,
          aggregateType: "board",
          type: "board.archived",
          occurredAt: new Date(),
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            boardId: input.boardId,
            archivedBy: ctx.session.user.id,
          },
        });

        return { success: true, boardId: input.boardId };
      });
    }),

  // ── unarchiveBoard (refactored) ──────────────────────────────────────────
  //
  // The single legitimate exception to the "no writes against archived
  // boards" rule. Uses the factory variant with allowArchived: true.
  unarchiveBoard: makeBoardAdminWriteProcedure({ allowArchived: true })
    .input(
      z.object({
        boardId: BoardIdSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        await ctx.repos.board.unarchive(input.boardId as BoardId, ctx.infra.db);

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.boardId,
          aggregateType: "board",
          type: "board.unarchived",
          occurredAt: new Date(),
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            boardId: input.boardId,
            unarchivedBy: ctx.session.user.id,
          },
        });

        return { success: true, boardId: input.boardId };
      });
    }),

  // ── deleteBoard (refactored — soft delete) ───────────────────────────────
  //
  // F2 boardAdminWriteProcedure already enforces OWNER/ADMIN role. The
  // pre-F3b implementation additionally required OWNER (not ADMIN) for
  // delete — that rule is preserved here as an explicit role check on
  // ctx.boardMembership.
  deleteBoard: boardAdminWriteProcedure
    .input(
      z.object({
        boardId: BoardIdSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        const role = (ctx as any).boardMembership?.role as string | undefined;
        if (role !== "OWNER") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "تنها مالک بورد می‌تواند آن را حذف کند.",
          });
        }

        const now = new Date();
        await ctx.repos.board.softDelete(input.boardId as BoardId, ctx.infra.db);

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.boardId,
          aggregateType: "board",
          type: "board.soft_deleted",
          occurredAt: now,
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            boardId: input.boardId,
            deletedAt: now.toISOString(),
            deletedBy: ctx.session.user.id,
          },
        });

        return { success: true, boardId: input.boardId };
      });
    }),

  // ── restoreBoard (NEW — undo soft-delete) ────────────────────────────────
  //
  // Operates on a soft-deleted board, so the lifecycle assertion in
  // boardAdminWriteProcedure (which rejects deletedAt != NULL) doesn't
  // fit. We use boardAdminProcedure (role check only) and read the row
  // directly to verify it is in the recoverable state.
  //
  // Note: the F2 boardMemberGuard fetches board membership but the
  // membership row persists across soft-delete (not cascaded). So the
  // role check still passes for the original admin/owner.
  //
  // 30-day grace window is enforced at the DB layer by a future cleanup
  // job (out of F3b scope — see steering/migrations.md). F3b accepts any
  // restore call; if the row was hard-deleted by the cleanup job the
  // findFirst below returns null and we surface NOT_FOUND.
  restoreBoard: boardAdminProcedure
    .input(
      z.object({
        boardId: BoardIdSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        const role = (ctx as any).boardMembership?.role as string | undefined;
        if (role !== "OWNER") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "تنها مالک بورد می‌تواند آن را بازگردانی کند.",
          });
        }

        const row = await ctx.infra.db.query.boards.findFirst({
          where: eq(boards.id, input.boardId),
        });
        if (!row) {
          throw new TRPCError({ code: "NOT_FOUND", message: "بورد یافت نشد." });
        }
        if (!row.deletedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "این بورد حذف نشده است.",
          });
        }

        const now = new Date();
        await ctx.repos.board.restore(input.boardId as BoardId, ctx.infra.db);

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.boardId,
          aggregateType: "board",
          type: "board.restored",
          occurredAt: now,
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            boardId: input.boardId,
            restoredAt: now.toISOString(),
            restoredBy: ctx.session.user.id,
          },
        });

        return { success: true, boardId: input.boardId };
      });
    }),

  // ── setBackground (NEW) ──────────────────────────────────────────────────
  setBackground: boardAdminWriteProcedure
    .input(
      z.object({
        boardId: BoardIdSchema,
        backgroundData: BackgroundDataSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        await ctx.repos.board.setBackground(
          input.boardId as BoardId,
          input.backgroundData,
          ctx.infra.db,
        );

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.boardId,
          aggregateType: "board",
          type: "board.background_changed",
          occurredAt: new Date(),
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            boardId: input.boardId,
            changedBy: ctx.session.user.id,
          },
        });

        return { success: true, boardId: input.boardId };
      });
    }),

  // ── updateVisibility (NEW) ───────────────────────────────────────────────
  //
  // No-op short-circuit when the new visibility matches current state —
  // mirrors workspace.updateVisibility.
  updateVisibility: boardAdminWriteProcedure
    .input(
      z.object({
        boardId: BoardIdSchema,
        visibility: VisibilitySchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        const board = await ctx.infra.db.query.boards.findFirst({
          where: eq(boards.id, input.boardId),
        });
        if (!board) {
          throw new TRPCError({ code: "NOT_FOUND", message: "بورد یافت نشد." });
        }

        if (board.visibility === input.visibility) {
          return {
            success: true,
            boardId: input.boardId,
            visibility: input.visibility,
            unchanged: true,
          };
        }

        const previousVisibility = board.visibility as "workspace" | "private" | "public";

        await ctx.repos.board.updateVisibility(
          input.boardId as BoardId,
          input.visibility,
          ctx.infra.db,
        );

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.boardId,
          aggregateType: "board",
          type: "board.visibility_changed",
          occurredAt: new Date(),
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            boardId: input.boardId,
            from: previousVisibility,
            to: input.visibility,
            changedBy: ctx.session.user.id,
          },
        });

        return {
          success: true,
          boardId: input.boardId,
          visibility: input.visibility,
          unchanged: false,
        };
      });
    }),
});
