// packages/infrastructure/src/notifications/__tests__/notificationText.test.ts
//
// Phase 1.2 (F1.2.9) — unit tests for the pure notification text builder.
// buildNotificationText has no I/O, so these are fast deterministic asserts.

import { describe, it, expect } from "vitest";

import { buildNotificationText } from "../notificationText";

const ACTOR = "علی";

describe("buildNotificationText — card.updated", () => {
  it("includes the actor and the new title when title changed", () => {
    const { title, body } = buildNotificationText(
      "card.updated",
      { changes: { title: "عنوان جدید" } },
      ACTOR,
    );
    expect(title).toBe("علی کارت را ویرایش کرد");
    expect(body).toBe("عنوان: عنوان جدید");
  });

  it("has an empty body when only the description changed", () => {
    const { title, body } = buildNotificationText(
      "card.updated",
      { changes: { description: "متن" } },
      ACTOR,
    );
    expect(title).toBe("علی کارت را ویرایش کرد");
    expect(body).toBe("");
  });
});

describe("buildNotificationText — card.assignee_added", () => {
  it("addresses the assignee and shows the card title when present", () => {
    const { title, body } = buildNotificationText(
      "card.assignee_added",
      { assigneeId: "u1", cardTitle: "طراحی صفحه" },
      ACTOR,
    );
    expect(title).toBe("علی شما را به کارت اضافه کرد");
    expect(body).toBe("در کارت: طراحی صفحه");
  });

  it("omits the body when no card title is provided", () => {
    const { body } = buildNotificationText(
      "card.assignee_added",
      { assigneeId: "u1" },
      ACTOR,
    );
    expect(body).toBe("");
  });
});

describe("buildNotificationText — card.due_date_updated", () => {
  it("formats a set due date", () => {
    const { title, body } = buildNotificationText(
      "card.due_date_updated",
      { newDueDate: "2025-03-30" },
      ACTOR,
    );
    expect(title).toBe("تاریخ سررسید تغییر کرد");
    expect(body.startsWith("سررسید:")).toBe(true);
    // Jalali-formatted, never the raw ISO string.
    expect(body).not.toContain("2025-03-30");
  });

  it("reports removal when the due date is cleared", () => {
    const { body } = buildNotificationText(
      "card.due_date_updated",
      { newDueDate: null },
      ACTOR,
    );
    expect(body).toBe("سررسید حذف شد");
  });
});

describe("buildNotificationText — comment.created", () => {
  it("uses the comment body as preview", () => {
    const { title, body } = buildNotificationText(
      "comment.created",
      { body: "این یک نظر است" },
      ACTOR,
    );
    expect(title).toBe("علی نظر جدید گذاشت");
    expect(body).toBe("این یک نظر است");
  });

  it("truncates a long comment to 100 chars + ellipsis", () => {
    const long = "x".repeat(250);
    const { body } = buildNotificationText("comment.created", { body: long }, ACTOR);
    expect(body.length).toBe(101); // 100 chars + the … ellipsis
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("buildNotificationText — checklist.item_updated", () => {
  it("combines actor and item text", () => {
    const { title, body } = buildNotificationText(
      "checklist.item_updated",
      { changes: { isDone: true, text: "خرید" } },
      ACTOR,
    );
    expect(title).toBe("آیتم چک‌لیست تکمیل شد");
    expect(body).toBe("علی: خرید");
  });
});

describe("buildNotificationText — board membership", () => {
  it("renders board.member.added", () => {
    const { title, body } = buildNotificationText("board.member.added", {}, ACTOR);
    expect(title).toBe("به برد اضافه شدید");
    expect(body).toBe("علی شما را به برد اضافه کرد");
  });

  it("renders board.member.removed", () => {
    const { title, body } = buildNotificationText("board.member.removed", {}, ACTOR);
    expect(title).toBe("از برد حذف شدید");
    expect(body).toBe("علی شما را از برد حذف کرد");
  });
});

describe("buildNotificationText — fallbacks", () => {
  it("falls back to «کاربر» when the actor name is empty", () => {
    const { title } = buildNotificationText(
      "comment.created",
      { body: "x" },
      "",
    );
    expect(title).toBe("کاربر نظر جدید گذاشت");
  });

  it("returns a generic notification for unknown event types", () => {
    const { title, body } = buildNotificationText("something.unknown", {}, ACTOR);
    expect(title).toBe("اعلان جدید");
    expect(body).toBe("");
  });
});
