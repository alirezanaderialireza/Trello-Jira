// packages/domain/src/comments/use-cases/__tests__/createComment.test.ts

import { describe, it, expect } from "vitest";

import { createComment, COMMENT_BODY_MAX_LENGTH } from "../createComment";
import {
  CommentBodyRequiredError,
  CommentBodyTooLongError,
} from "../../errors";
import type { BoardId, CardId, TenantId, UserId } from "../../../shared/ids";
import type { CommentId } from "../../types";

const TENANT_ID  = "11111111-1111-1111-1111-111111111111" as TenantId;
const CARD_ID    = "22222222-2222-2222-2222-222222222222" as CardId;
const BOARD_ID   = "33333333-3333-3333-3333-333333333333" as BoardId;
const AUTHOR_ID  = "44444444-4444-4444-4444-444444444444" as UserId;
const COMMENT_ID = "55555555-5555-5555-5555-555555555555" as CommentId;
const EVENT_ID   = "66666666-6666-6666-6666-666666666666";
const NOW        = new Date("2026-06-01T10:00:00.000Z");

const baseInput = {
  newCommentId: COMMENT_ID,
  tenantId:     TENANT_ID,
  cardId:       CARD_ID,
  boardId:      BOARD_ID,
  authorId:     AUTHOR_ID,
  body:         "این یک کامنت تست است.",
  now:          NOW,
  eventId:      EVENT_ID,
};

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("createComment — happy path", () => {
  it("returns entity + event with trimmed body", () => {
    const out = createComment({ ...baseInput, body: "  متن کامنت  " });

    expect(out.entity).toMatchObject({
      id:        COMMENT_ID,
      tenantId:  TENANT_ID,
      cardId:    CARD_ID,
      boardId:   BOARD_ID,
      authorId:  AUTHOR_ID,
      body:      "متن کامنت",
      revision:  1,
      createdAt: NOW,
      updatedAt: NOW,
      editedAt:  null,
      deletedAt: null,
      deletedBy: null,
    });

    expect(out.event.type).toBe("comment.created");
    expect(out.event.schemaVersion).toBe(2);
    expect(out.event.version).toBe(1);
    expect(out.event.aggregateId).toBe(CARD_ID);
    expect(out.event.aggregateType).toBe("card");
    expect(out.event.actorId).toBe(AUTHOR_ID);
    expect(out.event.tenantId).toBe(TENANT_ID);
    expect(out.event.occurredAt).toBe("2026-06-01T10:00:00.000Z");
    expect(out.event.payload).toEqual({
      commentId:  COMMENT_ID,
      cardId:     CARD_ID,
      boardId:    BOARD_ID,
      authorId:   AUTHOR_ID,
      body:       "متن کامنت",
      createdAt:  "2026-06-01T10:00:00.000Z",
      revision:   1,
    });
  });

  it("accepts ASCII body", () => {
    const out = createComment({ ...baseInput, body: "Hello world" });
    expect(out.entity.body).toBe("Hello world");
  });

  it("propagates correlationId to the event", () => {
    const out = createComment({ ...baseInput, correlationId: "corr-123" });
    expect(out.event.correlationId).toBe("corr-123");
  });

  it("accepts body exactly at the max-length limit", () => {
    const maxBody = "ب".repeat(COMMENT_BODY_MAX_LENGTH); // Persian letter × 5000
    const out = createComment({ ...baseInput, body: maxBody });
    expect(out.entity.body.length).toBe(COMMENT_BODY_MAX_LENGTH);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("createComment — validation", () => {
  it("rejects empty body", () => {
    expect(() => createComment({ ...baseInput, body: "   " }))
      .toThrowError(CommentBodyRequiredError);
  });

  it("rejects body longer than COMMENT_BODY_MAX_LENGTH", () => {
    expect(() =>
      createComment({ ...baseInput, body: "a".repeat(COMMENT_BODY_MAX_LENGTH + 1) }),
    ).toThrowError(CommentBodyTooLongError);
  });

  it("thrown CommentBodyTooLongError carries the max length", () => {
    try {
      createComment({ ...baseInput, body: "a".repeat(COMMENT_BODY_MAX_LENGTH + 1) });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CommentBodyTooLongError);
      expect((err as CommentBodyTooLongError).maxLength).toBe(COMMENT_BODY_MAX_LENGTH);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Purity
// ─────────────────────────────────────────────────────────────────────────────

describe("createComment — purity", () => {
  it("two identical inputs produce structurally equal outputs", () => {
    const a = createComment(baseInput);
    const b = createComment(baseInput);
    expect(a).toEqual(b);
  });

  it("does not mutate its input on happy path", () => {
    const input = { ...baseInput };
    const before = JSON.stringify(input);
    createComment(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not mutate its input when validation throws", () => {
    const input = { ...baseInput, body: "" };
    const before = JSON.stringify(input);
    expect(() => createComment(input)).toThrowError(CommentBodyRequiredError);
    expect(JSON.stringify(input)).toBe(before);
  });
});
