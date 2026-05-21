import type { Board } from "./types";

// ============================================================================
// Branded Primitive Types
// ============================================================================

export type BoardId = string & {
  readonly __brand: "BoardId";
};

export type TenantId = string & {
  readonly __brand: "TenantId";
};

export type UserId = string & {
  readonly __brand: "UserId";
};

export type Cursor = string & {
  readonly __brand: "Cursor";
};

export type Revision = number & {
  readonly __brand: "Revision";
};

export type MutationId = string & {
  readonly __brand: "MutationId";
};

// ============================================================================
// Transaction Contract
// ============================================================================

export interface RepositoryTransaction {
  readonly __brand: "RepositoryTransaction";
}

// ============================================================================
// Shared Pagination Contracts
// ============================================================================

export interface PaginationQuery {
  readonly cursor?: Cursor;
  readonly limit: number;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly nextCursor: Cursor | null;
}

// ============================================================================
// Query Contracts
// ============================================================================

export interface FindBoardByIdQuery {
  readonly boardId: BoardId;

  readonly tenantId: TenantId;

  readonly includeArchived?: boolean;

  readonly includeDeleted?: boolean;

  readonly tx?: RepositoryTransaction;

  readonly lock?:
    | {
        readonly mode: "FOR_UPDATE";
      }
    | {
        readonly mode: "NONE";
      };
}

export interface FindBoardsQuery
  extends PaginationQuery {
  readonly tenantId: TenantId;

  readonly includeArchived?: boolean;

  readonly includeDeleted?: boolean;

  readonly tx?: RepositoryTransaction;
}

export interface FindBoardByTitleQuery {
  readonly tenantId: TenantId;

  readonly title: string;

  readonly includeArchived?: boolean;

  readonly includeDeleted?: boolean;

  readonly tx?: RepositoryTransaction;
}

// ============================================================================
// Mutation Contracts
// ============================================================================

export interface CreateBoardMutation {
  readonly board: Board;

  readonly mutationId: MutationId;

  readonly tx?: RepositoryTransaction;
}

export interface UpdateBoardMutation {
  readonly board: Board;

  /**
   * OCC boundary.
   * Update MUST affect exactly one row.
   */
  readonly expectedRevision: Revision;

  readonly mutationId: MutationId;

  readonly tx?: RepositoryTransaction;
}

export interface DeleteBoardMutation {
  readonly boardId: BoardId;

  readonly tenantId: TenantId;

  readonly expectedRevision: Revision;

  readonly deletedAt: Date;

  readonly mutationId: MutationId;

  readonly strategy:
    | {
        readonly mode: "SOFT_DELETE";
      }
    | {
        readonly mode: "HARD_DELETE";
      };

  readonly tx?: RepositoryTransaction;
}

// ============================================================================
// Persistence Result Contracts
// ============================================================================

export interface RepositoryMutationResult {
  readonly affectedRows: number;
}

// ============================================================================
// Repository Contract
// ============================================================================

export interface BoardRepository {
  // ==========================================================================
  // Queries
  // ==========================================================================

  findById(
    query: FindBoardByIdQuery
  ): Promise<Board | null>;

  findByTitle(
    query: FindBoardByTitleQuery
  ): Promise<Board | null>;

  findMany(
    query: FindBoardsQuery
  ): Promise<PaginatedResult<Board>>;

  // ==========================================================================
  // Mutations
  // ==========================================================================

  create(
    mutation: CreateBoardMutation
  ): Promise<RepositoryMutationResult>;

  update(
    mutation: UpdateBoardMutation
  ): Promise<RepositoryMutationResult>;

  delete(
    mutation: DeleteBoardMutation
  ): Promise<RepositoryMutationResult>;
}