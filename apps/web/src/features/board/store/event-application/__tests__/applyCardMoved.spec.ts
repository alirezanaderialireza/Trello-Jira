// apps/web/src/features/board/store/event-application/__tests__/applyCardMoved.spec.ts

import { applyCardMoved } from "../applyCardMoved";

import { createBoardState } from "../../test-utils/createBoardState";

import type {
  BoardStoreState,
  CardDto,
} from "../../useBoardStore";

import type { ClientEventEnvelope } from "../types";

import type { CardMovedEvent } from "@repo/domain";

describe("applyCardMoved Reducer", () => {
  /**
   * ----------------------------------------------------------------
   * Helpers
   * ----------------------------------------------------------------
   */

  const mockCard = (
  overrides: Partial<CardDto>
): CardDto => ({
  id: "card-default",

  boardId: "board-1",

  title: "Default Card",

  listId: "list-default",

  position: "A",

  revision: 1,

  ...overrides,
});

  const createMoveEnvelope = (
    payload: CardMovedEvent["payload"],
    version = 2
  ): ClientEventEnvelope<CardMovedEvent> => ({
    event: {
      id: "evt-1",

      type: "card.moved",

      version,

      occurredAt: new Date().toISOString(),

      aggregateId: payload.cardId,

      aggregateType: "card",

      sequence: 1,

      actorId: "user-1",

      tenantId: "tenant-1",

      correlationId: "corr-1",

      payload,
    },

    optimistic: false,
  });

  /**
   * ----------------------------------------------------------------
   * Base State
   * ----------------------------------------------------------------
   */

  const initialState: BoardStoreState = createBoardState({
    cards: {
      c1: mockCard({
        id: "c1",
        title: "Card 1",
        listId: "l1",
        position: "A",
      }),

      c2: mockCard({
        id: "c2",
        title: "Card 2",
        listId: "l2",
        position: "C",
      }),
    },

    cardsByList: {
      l1: ["c1"],
      l2: ["c2"],
    },
  });

  /**
   * ----------------------------------------------------------------
   * Tests
   * ----------------------------------------------------------------
   */

  it("should move card from source list to destination list", () => {
    const envelope = createMoveEnvelope({
      cardId: "c1",

      fromListId: "l1",

      toListId: "l2",

      oldPosition: "A",

      newPosition: "B",

      boardId: "b1",
    });

    const result = applyCardMoved(
      initialState,
      envelope,
      { mode: "live" }
    );

    expect(result.cards?.["c1"].listId).toBe("l2");

    expect(result.cards?.["c1"].position).toBe("B");

    expect(result.cards?.["c1"].revision).toBe(2);

    expect(result.cardsByList?.["l1"]).toEqual([]);

    expect(result.cardsByList?.["l2"]).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("should ignore stale events", () => {
    const envelope = createMoveEnvelope(
      {
        cardId: "c1",

        fromListId: "l1",

        toListId: "l2",

        oldPosition: "A",

        newPosition: "Z",

        boardId: "b1",
      },

      1 // stale version
    );

    const result = applyCardMoved(
      initialState,
      envelope,
      { mode: "live" }
    );

    expect(result).toEqual({});
  });

  it("should be replay-safe when card does not exist", () => {
    const envelope = createMoveEnvelope({
      cardId: "missing-card",

      fromListId: "l1",

      toListId: "l2",

      oldPosition: "A",

      newPosition: "X",

      boardId: "b1",
    });

    const result = applyCardMoved(
      initialState,
      envelope,
      { mode: "replay" }
    );

    expect(result).toEqual({});
  });

  it("should not mutate original state", () => {
    const envelope = createMoveEnvelope({
      cardId: "c1",

      fromListId: "l1",

      toListId: "l2",

      oldPosition: "A",

      newPosition: "B",

      boardId: "b1",
    });

    const frozenState = structuredClone(initialState);

    applyCardMoved(
      initialState,
      envelope,
      { mode: "live" }
    );

    expect(initialState).toEqual(frozenState);
  });

  it("should keep deterministic order after sorting", () => {
    const state: BoardStoreState = createBoardState({
      cards: {
        ...initialState.cards,

        c3: mockCard({
          id: "c3",
          title: "Card 3",
          listId: "l2",
          position: "B",
        }),
      },

      cardsByList: {
        l1: ["c1"],

        l2: ["c2", "c3"],
      },
    });

    const envelope = createMoveEnvelope({
      cardId: "c1",

      fromListId: "l1",

      toListId: "l2",

      oldPosition: "A",

      newPosition: "B",

      boardId: "b1",
    });

    const result = applyCardMoved(
      state,
      envelope,
      { mode: "live" }
    );

    /**
     * c1 and c3 have same position ("B")
     * deterministic tie-breaker => compare by ID
     * c1 < c3
     */

    expect(result.cardsByList?.["l2"]).toEqual([
      "c1",
      "c3",
      "c2",
    ]);
  });
});