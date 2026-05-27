// packages/api/src/middleware/boardRoleProcedures.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Two board-scoped tRPC procedure builders:
//
//   boardMemberProcedure  — alias of the existing `boardProtectedProcedure`,
//                           re-exported under the F2-spec name for symmetry
//                           with the workspace builders. Zero new code.
//
//   boardAdminProcedure   — extends `boardMemberProcedure` with a role
//                           assertion on `ctx.boardMembership.role`.
//                           Caller must be OWNER or ADMIN of the board.
//
// Note on board roles: `BoardRole` from `acl/aclEngine.ts` is a SUPERSET of
// the workspace role enum and includes 'EDITOR' / 'VIEWER' / 'NONE'. The
// admin assertion here matches OWNER and ADMIN literally (NOT EDITOR — an
// EDITOR can edit content but cannot manage the board's membership /
// settings / lifecycle).
// ─────────────────────────────────────────────────────────────────────────────

import { TRPCError } from "@trpc/server";
import { boardProtectedProcedure } from "../trpc";

// ─── Public alias ───────────────────────────────────────────────────────────

/**
 * `boardMemberProcedure` is an alias of `boardProtectedProcedure` from
 * `../trpc`. The base loader (`boardMemberGuard`) already populates
 * `ctx.boardMembership = { memberId, role, boardId }`. The alias exists
 * solely so F3 routers can read consistently as
 *   workspaceMemberProcedure / boardMemberProcedure
 * without one calling itself "protected" and the other "member".
 */
export const boardMemberProcedure = boardProtectedProcedure;

// ─── Internal helper (exported for tests) ───────────────────────────────────

/**
 * Throws FORBIDDEN unless the supplied board role is OWNER or ADMIN.
 *
 * The role argument is typed as `string | undefined` rather than the
 * narrow `BoardRole` union because `ctx.boardMembership.role` is read
 * out of a varchar column and surfaces as `string` through the existing
 * boardMemberGuard. Narrowing to `BoardRole` here would force a
 * type-only refactor of the guard which is out of F2 scope.
 */
export function requireBoardManagerRole(role: string | undefined): void {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "این عملیات فقط برای مدیر یا مالک بورد مجاز است.",
    });
  }
}

// ─── Procedure builder ──────────────────────────────────────────────────────

export const boardAdminProcedure = boardProtectedProcedure.use(
  async ({ ctx, next }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const role = (ctx as any).boardMembership?.role as string | undefined;
    requireBoardManagerRole(role);
    return next();
  },
);
