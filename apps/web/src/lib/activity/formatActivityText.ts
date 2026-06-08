// apps/web/src/lib/activity/formatActivityText.ts
//
// Phase 1.2 (F1.2.6) — pure function that converts an ActivityEntry
// into a human-readable Persian string.
//
// Rules:
//   • Pure — no side-effects, no Date.now(), injectable.
//   • All text Persian.
//   • Numbers via fa-IR locale.
//   • Dates via toJalaliDisplay from @/lib/date.
//   • actorName fallback: «کاربر».
//   • label/list fallback: «حذف‌شده».

import { toJalaliDisplay, getUserTZ, type UTCDateTime, type DateOnly } from "@/lib/date";

interface EnrichedEntry {
  actorName?:    string | null;
  eventType:     string;
  payload:       Record<string, unknown>;
}

function actor(name?: string | null): string {
  return name?.trim() || "کاربر";
}

function jalali(date: string | null | undefined): string {
  if (!date) return "";
  const tz = getUserTZ();
  return toJalaliDisplay(date as UTCDateTime | DateOnly, tz, "D MMMM YYYY");
}

/** Returns a Persian sentence describing what happened in this activity entry. */
export function formatActivityText(entry: EnrichedEntry): string {
  const a   = actor(entry.actorName);
  const p   = entry.payload;

  switch (entry.eventType) {

    // ── Card events ──────────────────────────────────────────────────────

    case "card.created":
      return `${a} این کارت را ساخت`;

    case "card.updated": {
      const ch = (p.changes ?? {}) as Record<string, unknown>;
      const hasTitle = ch.title !== undefined;
      const hasDesc  = ch.description !== undefined;
      if (hasTitle && hasDesc)      return `${a} عنوان و توضیحات را ویرایش کرد`;
      if (hasTitle)                 return `${a} عنوان را به «${ch.title}» تغییر داد`;
      if (hasDesc)                  return `${a} توضیحات را ویرایش کرد`;
      return `${a} کارت را ویرایش کرد`;
    }

    case "card.moved": {
      const from = (p.fromListTitle as string | null) ?? null;
      const to   = (p.toListTitle   as string | null) ?? null;
      if (from && to) return `${a} کارت را از «${from}» به «${to}» منتقل کرد`;
      return `${a} کارت را جابجا کرد`;
    }

    case "card.deleted":
      return `${a} این کارت را حذف کرد`;

    case "card.locked":
      return `${a} کارت را قفل کرد`;

    case "card.unlocked":
      return `${a} قفل کارت را باز کرد`;

    case "card.due_date_updated": {
      const newDate = p.newDueDate as string | null | undefined;
      const oldDate = p.oldDueDate as string | null | undefined;
      if (!newDate)  return `${a} تاریخ سررسید را حذف کرد`;
      if (!oldDate)  return `${a} تاریخ سررسید را به ${jalali(newDate)} تعیین کرد`;
      return `${a} تاریخ سررسید را از ${jalali(oldDate)} به ${jalali(newDate)} تغییر داد`;
    }

    case "card.label_added": {
      const name = (p.labelName as string | null) ?? null;
      return name
        ? `${a} برچسب «${name}» را اضافه کرد`
        : `${a} یک برچسب اضافه کرد`;
    }

    case "card.label_removed": {
      const name = (p.labelName as string | null) ?? null;
      return name
        ? `${a} برچسب «${name}» را حذف کرد`
        : `${a} یک برچسب حذف کرد`;
    }

    case "card.assignee_added":
      return `${a} یک مسئول به کارت اضافه کرد`;

    case "card.assignee_removed":
      return `${a} یک مسئول را از کارت حذف کرد`;

    // ── Comment events ───────────────────────────────────────────────────

    case "comment.created":
      return `${a} یک نظر ثبت کرد`;

    case "comment.updated":
      return `${a} نظر خود را ویرایش کرد`;

    case "comment.deleted":
      return `${a} یک نظر را حذف کرد`;

    // ── Checklist events ─────────────────────────────────────────────────

    case "checklist.created": {
      const title = p.title as string | null | undefined;
      return title
        ? `${a} چک‌لیست «${title}» را اضافه کرد`
        : `${a} یک چک‌لیست اضافه کرد`;
    }

    case "checklist.updated": {
      const ch = (p.changes ?? {}) as Record<string, unknown>;
      if (ch.title !== undefined) return `${a} نام چک‌لیست را تغییر داد`;
      return `${a} چک‌لیست را ویرایش کرد`;
    }

    case "checklist.deleted":
      return `${a} چک‌لیست را حذف کرد`;

    case "checklist.item_added": {
      const text = p.text as string | null | undefined;
      return text
        ? `${a} «${text}» را به چک‌لیست اضافه کرد`
        : `${a} یک آیتم به چک‌لیست اضافه کرد`;
    }

    case "checklist.item_updated": {
      const ch   = (p.changes ?? {}) as Record<string, unknown>;
      const text = p.text as string | null | undefined;
      if (ch.isDone === true)        return `${a} «${text ?? "آیتم"}» را کامل کرد`;
      if (ch.isDone === false)       return `${a} «${text ?? "آیتم"}» را ناتمام علامت زد`;
      if (ch.text !== undefined)     return `${a} یک آیتم چک‌لیست را ویرایش کرد`;
      return `${a} ترتیب آیتم‌های چک‌لیست را تغییر داد`;
    }

    case "checklist.item_removed":
      return `${a} یک آیتم را از چک‌لیست حذف کرد`;

    // ── Default ──────────────────────────────────────────────────────────

    default:
      return `${a} یک تغییر ایجاد کرد`;
  }
}
