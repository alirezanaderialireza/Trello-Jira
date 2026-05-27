// packages/api/src/middleware/invariants/boardInvariants.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Board-specific invariant mappers — translate the discriminated `Result`
// returned by `domain/board/use-cases/*` to `TRPCError` with Persian
// messages.
//
// The use cases stay pure (Result<failure>) so they can be unit-tested
// without a tRPC pipeline. The router boundary is responsible for the
// translation, and that translation lives here in one place — not
// duplicated inside every router that calls `addBoardMember`.
//
// ─────────────────────────────────────────────────────────────────────────────
// Pattern parity:
//   • workspace invariants throw error classes from ./errors (legacy
//     pattern, kept for back-compat with the F2 procedures).
//   • board invariants take a Result and rethrow as TRPCError directly,
//     mirroring the F3a.3 acceptInvitation/revokeInvitation handling.
// Both styles are accepted; new use cases prefer the Result form.
// ─────────────────────────────────────────────────────────────────────────────

import { TRPCError } from "@trpc/server";
import type { AddBoardMemberFailureReason } from "@repo/domain";

/**
 * Throws a TRPCError matching the failure reason. Caller passes the use
 * case's `result.reason` directly.
 */
export function throwAddBoardMemberError(
  reason: AddBoardMemberFailureReason,
): never {
  switch (reason) {
    case "SELF_INVITE":
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "نمی‌توانید خودتان را به بورد اضافه کنید.",
      });
    case "TARGET_NOT_WORKSPACE_MEMBER":
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "این کاربر باید ابتدا عضو فضای کاری باشد. لطفاً او را به فضای کاری دعوت کنید.",
      });
    default: {
      // Exhaustiveness: TypeScript narrows `reason` to `never` here.
      // If a new failure reason is added without a case, this throws at
      // runtime AND fails compilation in strict mode.
      const exhaustive: never = reason;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Unhandled addBoardMember failure: ${exhaustive}`,
      });
    }
  }
}
