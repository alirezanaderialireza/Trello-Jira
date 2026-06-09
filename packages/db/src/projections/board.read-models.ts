// packages/db/src/projections/board.read-models.ts
import { eq, and, isNull, asc, inArray } from "drizzle-orm";
import { boards, lists, cards, cardLabels, cardAssignees } from "../schema";

export class BoardReadModels {
  // 🔹 اضافه کردن list برای سازگاری با routerها
  public list = this;

  constructor(private readonly db: any) {}

  // ========================================================================
  // 🔹 دریافت اطلاعات پایه بورد (Basic Board Details)
  // ========================================================================
  async getBoardDetails(boardId: string, tenantId: string) {
    const result = await this.db
      .select()
      .from(boards)
      .where(
        and(eq(boards.id, boardId), eq(boards.tenantId, tenantId), isNull(boards.deletedAt))
      )
      .limit(1);

    return result[0] || null;
  }

  // ========================================================================
  // 🔹 Projection کامل بورد با لیست‌ها و کارت‌ها
  // ========================================================================
  async getBoardProjection(params: {
    boardId: string;
    userId: string;
    tenantId: string;
    listPagination?: { cursor?: string; limit?: number };
    correlationId?: string;
  }) {
    const board = await this.db.query.boards.findFirst({
      where: and(eq(boards.id, params.boardId), eq(boards.tenantId, params.tenantId), isNull(boards.deletedAt)),
    });

    if (!board) return { data: null, hasAccess: false };

    const allLists = await this.db.query.lists.findMany({
      where: and(eq(lists.boardId, params.boardId), isNull(lists.deletedAt)),
      orderBy: [asc(lists.position)],
      with: {
        cards: {
          where: isNull(cards.deletedAt),
          orderBy: [asc(cards.position)],
        },
      },
    });

    // ── Batched per-card relation hydration (no N+1) ─────────────────────────
    // labels (card_labels), assignees (card_assignees) and attachmentCount are
    // NOT covered by the cards relation graph, so the initial projection used
    // to render "naked" cards until per-card queries / realtime events arrived.
    // We fetch all label + assignee rows for the board's cards in two queries
    // and group them in memory, matching the store `CardDto` shape
    // (labels: labelId[], assignees: userId[], attachmentCount: number).
    const cardIds: string[] = allLists.flatMap((list: any) =>
      (list.cards ?? []).map((c: any) => c.id),
    );

    const labelsByCard: Record<string, string[]> = {};
    const assigneesByCard: Record<string, string[]> = {};

    if (cardIds.length > 0) {
      const labelRows = await this.db
        .select({ cardId: cardLabels.cardId, labelId: cardLabels.labelId })
        .from(cardLabels)
        .where(
          and(
            eq(cardLabels.tenantId, params.tenantId),
            inArray(cardLabels.cardId, cardIds),
          ),
        );
      for (const row of labelRows as Array<{ cardId: string; labelId: string }>) {
        (labelsByCard[row.cardId] ??= []).push(row.labelId);
      }

      const assigneeRows = await this.db
        .select({ cardId: cardAssignees.cardId, userId: cardAssignees.userId })
        .from(cardAssignees)
        .where(
          and(
            eq(cardAssignees.tenantId, params.tenantId),
            inArray(cardAssignees.cardId, cardIds),
          ),
        )
        // D7: assignedAt asc → stable avatar ordering on the card preview.
        .orderBy(asc(cardAssignees.assignedAt));
      for (const row of assigneeRows as Array<{ cardId: string; userId: string }>) {
        (assigneesByCard[row.cardId] ??= []).push(row.userId);
      }
    }

    const projection = {
      id: board.id,
      title: board.title,
      boardSequence: board.currentSequence || 0,
      lists: allLists.map((list: any) => ({
        id: list.id,
        title: list.title,
        position: list.position,
        revision: list.revision,
        cards: list.cards.map((card: any) => ({
          id: card.id,
          title: card.title,
          position: card.position,
          revision: card.revision,
          description: card.description,
          dueDate: card.dueDate ?? null,
          coverData: card.coverData ?? null,
          // ── Hydrated relations (match store CardDto) ─────────────────────
          labels: labelsByCard[card.id] ?? [],
          assignees: assigneesByCard[card.id] ?? [],
          attachmentCount: card.attachmentCount ?? 0,
        })),
      })),
    };

    return { data: projection, hasAccess: true };
  }

  // ========================================================================
  // 🔹 دریافت لیست‌ها بر اساس BoardId (برای listRouter)
  // ========================================================================
  async getListsByBoard(params: {
    boardId: string;
    tenantId: string;
    userId: string;
    listPagination?: Record<string, { cursor?: string; limit?: number }>;
    minSequence?: string;
    abortSignal?: AbortSignal;
    traceId?: string;
    spanId?: string;
    correlationId?: string;
  }) {
    const board = await this.getBoardDetails(params.boardId, params.tenantId);
    if (!board) return { data: null, hasAccess: false };

    const allLists = await this.db.query.lists.findMany({
      where: and(eq(lists.boardId, params.boardId), isNull(lists.deletedAt)),
      orderBy: [asc(lists.position)],
      with: {
        cards: {
          where: isNull(cards.deletedAt),
          orderBy: [asc(cards.position)],
        },
      },
    });

    // ✅ FIX: when listPagination is undefined/empty, return ALL lists.
    // Previous bug: Object.values({}) returns [] → flatMap returns [] → empty board.
    const paginatedLists =
      params.listPagination && Object.keys(params.listPagination).length > 0
        ? Object.values(params.listPagination).flatMap(
            (lp) => allLists.slice(0, lp.limit ?? 50),
          )
        : allLists;

    return {
      data: paginatedLists,
      hasAccess: true,
      aclVersion: board.aclVersion ?? 0,
      boardSequence: board.currentSequence ?? 0,
      projectionSequence: board.currentSequence ?? 0,
      lastUpdatedTs: Date.now(),
      isDegraded: false,
    };
  }

  // ========================================================================
  // 🔹 دریافت کارت‌ها بر اساس ListId (برای cardRouter)
  // ========================================================================
  async getCardsByList(params: {
    listId: string;
    tenantId: string;
    userId: string;
    cursor?: string;
    limit?: number;
    sinceSequence?: string;
    correlationId?: string;
  }) {
    const list = await this.db.query.lists.findFirst({
      where: and(eq(lists.id, params.listId), eq(lists.tenantId, params.tenantId), isNull(lists.deletedAt)),
    });

    if (!list) {
      return { data: [], hasAccess: false, aclVersion: 0, currentSequence: "0", nextCursor: undefined };
    }

    const allCards = await this.db.query.cards.findMany({
      where: and(eq(cards.listId, params.listId), isNull(cards.deletedAt)),
      orderBy: [asc(cards.position)],
      limit: params.limit,
    });

    return {
      data: allCards,
      hasAccess: true,
      aclVersion: list.revision || 0,
      currentSequence: list.currentSequence || "0",
      nextCursor: undefined,
    };
  }
}