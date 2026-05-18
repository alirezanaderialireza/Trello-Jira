// packages/domain/src/board/board.repository.ts
//
// Fixes applied:
// ✅ #D-01: Branded types (BoardId, TenantId, UserId, Revision, MutationId)
//           were re-declared here, diverging from shared/ids.ts.
//           Two definitions of the same branded type are structurally identical
//           but create TWO distinct opaque types — TypeScript treats them as
//           incompatible. Any code importing BoardId from shared/ids.ts cannot
//           pass the value where board.repository.ts's BoardId is expected.
//           Fix: re-export from shared/ids.ts instead of re-declaring.
//
// ✅ #D-02: BoardRepository interface signature uses bespoke query/mutation
//           objects (FindBoardByIdQuery, CreateBoardMutation, etc.) that are
//           incompatible with the generic port contract in ports/index.ts.
//           DrizzleBoardRepository implements ports/index.ts BoardRepository<TTx>
//           not this interface — so this interface is orphaned / never used.
//           Fix: align interface with ports/index.ts contract so it is actually
//           implemented and can be type-checked against the implementation.

import type { Board } from "./types";

// ✅ #D-01: re-export from canonical location — no duplicate branded types
export type {
  BoardId,
  TenantId,
  UserId,
  Revision,
  MutationId,
  CorrelationId,
} from "../shared/ids";

// ============================================================================
// Pagination helpers (kept for create-board.ts use)
// ============================================================================

export type Cursor = string & { readonly __brand: "Cursor" };

export interface PaginationQuery {
  readonly cursor?: Cursor;
  readonly limit: number;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly nextCursor: Cursor | null;
}

// ============================================================================
// Persistence Result (kept for create-board.ts)
// ============================================================================

export interface RepositoryMutationResult {
  readonly affectedRows: number;
}

// ============================================================================
// ✅ #D-02: BoardRepository now aligns with ports/index.ts contract.
//    DrizzleBoardRepository implements BoardRepository<TTx> from ports/index.ts.
//    This local interface is kept only for create-board.ts which uses the
//    more detailed mutation-object style. It extends the port contract so
//    both are satisfied by the same implementation.
// ============================================================================

import type { BoardRepository as PortBoardRepository } from "../ports";
import type { BoardId, TenantId, Revision, MutationId } from "../shared/ids";

export interface CreateBoardMutation {
  readonly board: Board;
  readonly mutationId: MutationId;
  readonly tx?: unknown;
}

export interface BoardRepository extends PortBoardRepository<unknown> {
  // Extra method used by create-board.ts use-case
  create(mutation: CreateBoardMutation): Promise<RepositoryMutationResult>;
}