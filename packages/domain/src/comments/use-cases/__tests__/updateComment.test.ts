// packages/domain/src/comments/use-cases/__tests__/updateComment.test.ts

import { describe, it, expect } from "vitest";

import { updateComment, } from "../updateComment";
import { COMMENT_BODY_MAX_LENGTH } from "../createComment";
import {
  CommentBodyRequiredError,
  CommentBodyTooLongError,
} from "../../errors";
import type { BoardId, CardId, TenantId, UserId } from "../../../shared/ids";
import type { CommentEntity, CommentId } from "../../types";

const TENANT_ID  = "11111111-1111-1111-1111-111111111111" as TenantId;
const CARD_ID    = "22222222-2222-2222-2222-222222222222" as CardId;
const BOARD_ID   = "33333333-3333-3333-3333-333333333333" as BoardId;
const AUTHOR_ID  = "44444444-4444-4444-4444-444444444444" as UserId;
const COMMENT_ID = "55555555-5555-5555-5555-555555555555" as CommentId;
const EVENT_ID   = "66666666-6666-6666-6666-666666666666";
const NOW        = new Date("2026-06-01T12:00:00.000Z");

const current: CommentEntity = {
  id:        COMMENT_ID,
  tenantId:  TENANT_ID,
  cardId:    CARD_ID,
  boardId:   BOARD_ID,
  authorId:  AUTHOR_ID,
  body:      "متن اصلی",
  revision:  1,
  createdAt: new Date("2026-06-01T10:00:00.000Z"),
  updatedAt: new Date("2026-06-01T10:00:00.000Z"),
  editedAt:  null,
  deletedAt: null,
  deletedBy: null,
};

const baseInput = {
  current,
  body:    "متن ویرایش‌شده",
  actorId: AUTHOR_ID,
  now:     NOW,
  eventId: EVENT_ID,
};

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("updateComment — happy path", () => {
  it("returns noOp=false with patch + event on body change", () => {
    const out = updateComment(baseInput);

    expect(out.noOp).toBe(false);
    if (out.noOp) return; // type-narrow for TS

    expect(out.patch).toEqual({
      body:      "متن ویرایش‌شده",
      editedAt:  NOW,
      updatedAt: NOW,
      revision:  2,
    });

    expect(out.event.type).toBe("comment.updated");
    expect(out.event.schemaVersion).toBe(2);
    expect(out.event.version).toBe(2);          // revision + 1
    expect(out.event.aggregateId).toBe(CARD_ID);
    expect(out.event.aggregateType).toBe("card");
    expect(out.event.actorId).toBe(AUTHOR_ID);
    expect(out.event.payload).toEqual({
      commentId: COMMENT_ID,
      cardId:    CARD_ID,
      boardId:   BOARD_ID,
      body:      "متن ویرایش‌شده",
      editedAt:  NOW.toISOString(),
    });
  });

  it("trims whitespace before comparing", () => {
    const out = updateComment({ ...baseInput, body: "  متن ویرایش‌شده  " });
    expect(out.noOp).toBe(false);
    if (out.noOp) return;
    expect(out.patch.body).toBe("متن ویرایش‌شده");
  });

  it("propagates correlationId to the event", () => {
    const out = updateComment({ ...baseInput, correlationId: "corr-upd" });
    expect(out.noOp).toBe(false);
    if (out.noOp) return;
    expect(out.event.correlationId).toBe("corr-upd");
  });

  it("revision increments by 1", () => {
    const withRev3 = { ...current, revision: 3 };
    const out = updateComment({ ...baseInput, current: withRev3 });
    expect(out.noOp).toBe(false);
    if (out.noOp) return;
    expect(out.patch.revision).toBe(4);
    expect(out.event.version).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No-op detection
// ─────────────────────────────────────────────────────────────────────────────

describe("updateComment — no-op detection", () => {
  it("returns noOp=true when body equals current body", () => {
    const out = updateComment({ ...baseInput, body: "متن اصلی" });
    expect(out.noOp).toBe(true);
    expect(out.patch).toEqual({});
  });

  it("returns noOp=true when body equals current body after trim", () => {
    const out = updateComment({ ...baseInput, body: "  متن اصلی  " });
    expect(out.noOp).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("updateComment — validation", () => {
  it("rejects empty body", () => {
    expect(() => updateComment({ ...baseInput, body: "   " }))
      .toThrowError(CommentBodyRequiredError);
  });

  it("rejects body longer than max length", () => {
    expect(() =>
      updateComment({ ...baseInput, body: "a".repeat(COMMENT_BODY_MAX_LENGTH + 1) }),
    ).toThrowError(CommentBodyTooLongError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Purity
// ─────────────────────────────────────────────────────────────────────────────

describe("updateComment — purity", () => {
  it("two identical inputs produce structurally equal outputs", () => {
    const a = updateComment(baseInput);
    const b = updateComment(baseInput);
    expect(a).toEqual(b);
  });

  it("does not mutate its input on happy path", () => {
    const input = { ...baseInput };
    const before = JSON.stringify(input);
    updateComment(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not mutate its input when validation throws", () => {
    const input = { ...baseInput, body: "" };
    const before = JSON.stringify(input);
    expect(() => updateComment(input)).toThrowError(CommentBodyRequiredError);
    expect(JSON.stringify(input)).toBe(before);
  });
});
