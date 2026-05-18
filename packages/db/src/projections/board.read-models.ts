// packages/db/src/projections/board.read-models.ts
//
// Fixes applied:
// ✅ BUG-005: getListsByBoard() pagination was flatMap-duplicating all lists.
//             Object.values(pagination).flatMap(lp => allLists.slice(0, limit))
//             produces N × allLists duplicates where N = number of pagination keys.
//             Fix: return allLists directly when no pagination, or apply a single
//             limit from the first pagination entry.
// ✅ BUG-009: getCardsByList() — list.currentSequence doesn't exist on the lists
//             schema. Always returned undefined which coerced to "0".
//             Fix: return "0" explicitly; board-level sequence is not per-list.

import { eq, and, isNull, asc } from "drizzle-orm";
import { boards, lists, cards } from "../schema";

export class BoardReadModels {
  // Alias kept for backward compat: ctx.readModels.list.getListsByBoard(...)
  public list = this;

  constructor(private readonly db: any) {}

  // =========================================================================
  // getBoardDetails — internal helper
  // =========================================================================

  async getBoardDetails(boardId: string, tenantId: string) {
    const result = await this.db
      .select()
      .from(boards)
      .where(
        and(
          eq(boards.id, boardId),
          eq(boards.tenantId, tenantId),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1);

    return result[0] ?? null;
  }

  // =========================================================================
  // getBoardProjection — full board with lists + cards (for getFullBoard)
  // =========================================================================

  async getBoardProjection(params: {
    boardId:        string;
    userId:         string;
    tenantId:       string;
    listPagination?: { cursor?: string; limit?: number };
    correlationId?: string;
  }) {
    const board = await this.db.query.boards.findFirst({
      where: and(
        eq(boards.id, params.boardId),
        eq(boards.tenantId, params.tenantId),
        isNull(boards.deletedAt),
      ),
    });

    if (!board) return { data: null, hasAccess: false };

    const allLists = await this.db.query.lists.findMany({
      where:   and(eq(lists.boardId, params.boardId), isNull(lists.deletedAt)),
      orderBy: [asc(lists.position)],
      with: {
        cards: {
          where:   isNull(cards.deletedAt),
          orderBy: [asc(cards.position)],
        },
      },
    });

    const projection = {
      id:            board.id,
      title:         board.title,
      boardSequence: board.currentSequence ?? 0,
      lists: allLists.map((list: any) => ({
        id:       list.id,
        title:    list.title,
        position: list.position,
        revision: list.revision,
        cards: list.cards.map((card: any) => ({
          id:          card.id,
          boardId:     card.boardId,
          listId:      card.listId,
          title:       card.title,
          position:    card.position,
          revision:    card.revision,
          description: card.description ?? null,
        })),
      })),
    };

    return { data: projection, hasAccess: true };
  }

  // =========================================================================
  // getListsByBoard — for listRouter
  // ✅ BUG-005: pagination no longer duplicates lists
  // =========================================================================

  async getListsByBoard(params: {
    boardId:         string;
    tenantId:        string;
    userId:          string;
    listPagination?: Record<string, { cursor?: string; limit?: number }>;
    minSequence?:    string;
    abortSignal?:    AbortSignal;
    traceId?:        string;
    spanId?:         string;
    correlationId?:  string;
  }) {
    const board = await this.getBoardDetails(params.boardId, params.tenantId);
    if (!board) return { data: null, hasAccess: false };

    const allLists = await this.db.query.lists.findMany({
      where:   and(eq(lists.boardId, params.boardId), isNull(lists.deletedAt)),
      orderBy: [asc(lists.position)],
      with: {
        cards: {
          where:   isNull(cards.deletedAt),
          orderBy: [asc(cards.position)],
        },
      },
    });

    // ✅ BUG-005: simple limit — no flatMap duplication
    const paginationEntries = Object.values(params.listPagination ?? {});
    const limit = paginationEntries.length > 0
      ? (paginationEntries[0]?.limit ?? 50)
      : 50;

    const paginatedLists = allLists.slice(0, limit);

    return {
      data:               paginatedLists,
      hasAccess:          true,
      aclVersion:         board.aclVersion         ?? 0,
      boardSequence:      board.currentSequence     ?? 0,
      projectionSequence: board.currentSequence     ?? 0,
      lastUpdatedTs:      Date.now(),
      isDegraded:         false,
    };
  }

  // =========================================================================
  // getCardsByList — for cardRouter
  // ✅ BUG-009: currentSequence column doesn't exist on lists — return "0"
  // =========================================================================

  async getCardsByList(params: {
    listId:          string;
    tenantId:        string;
    userId:          string;
    cursor?:         string;
    limit?:          number;
    sinceSequence?:  string;
    correlationId?:  string;
  }) {
    const list = await this.db.query.lists.findFirst({
      where: and(
        eq(lists.id, params.listId),
        eq(lists.tenantId, params.tenantId),
        isNull(lists.deletedAt),
      ),
    });

    if (!list) {
      return {
        data:            [],
        hasAccess:       false,
        aclVersion:      0,
        currentSequence: "0",
        nextCursor:      undefined,
      };
    }

    const allCards = await this.db.query.cards.findMany({
      where:   and(eq(cards.listId, params.listId), isNull(cards.deletedAt)),
      orderBy: [asc(cards.position)],
      limit:   params.limit ?? 50,
    });

    return {
      data:            allCards,
      hasAccess:       true,
      aclVersion:      list.revision ?? 0,
      // ✅ BUG-009: lists table has no currentSequence column — always "0"
      currentSequence: "0",
      nextCursor:      undefined,
    };
  }
}
