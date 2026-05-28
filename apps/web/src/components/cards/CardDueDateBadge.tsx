// apps/web/src/components/cards/CardDueDateBadge.tsx
//
// Pure presentational badge for a card's due date. Lives in shared
// territory (apps/web/src/components/cards/) instead of features/cards
// because two consumers from different feature folders need it:
//   • CardItem in features/board — top of the preview, when dueDate
//     is set.
//   • CardDueDate in features/board/components/card-detail — same
//     surface, larger size.
// Cross-feature imports (features/board → features/cards) are blocked
// by the boundaries linter (PR #46, error severity), so the badge
// hoists to shared. Mirrors the F1.2.1.b D21 resolution for
// LabelBadge.
//
// Time engine
//   All date logic goes through `@/lib/date` — never `new Date()`,
//   never a direct dayjs import (date-engine.md golden rule).
//   `isOverdue` and `toJalaliDisplay` are the only entry points the
//   badge needs. The badge uses `nowUIOnly()` for the today / overdue
//   comparison; this is the documented exception in date-engine.md
//   ("for display only — never persist it"). For server-time-strict
//   accuracy a future tRPC `system.now` endpoint could be wired here,
//   but the UX cost of being a few seconds off the server clock is
//   negligible for a calendar-day comparison.

import { Calendar } from "lucide-react";

import {
  getUserTZ,
  isOverdue,
  nowUIOnly,
  toDateOnlyUTC,
  toJalaliDisplay,
  type DateOnly,
  type UTCDateTime,
} from "@/lib/date";

export type CardDueDateBadgeSize = "sm" | "md";

interface Props {
  /**
   * The card's due date as a `YYYY-MM-DD` string. The component does
   * NOT render anything when this is null/undefined — callers that
   * want a "no date" placeholder render their own empty state.
   */
  dueDate: string;
  size?: CardDueDateBadgeSize;
  /** Show a calendar icon to the start of the text. Default true. */
  showIcon?: boolean;
  className?: string;
}

export function CardDueDateBadge({
  dueDate,
  size = "sm",
  showIcon = true,
  className = "",
}: Props) {
  // The wire shape is plain `string`; we widen to the union the time
  // engine accepts.
  const due = dueDate as DateOnly;

  // "Today" in the user's timezone. We compute it once per render —
  // the badge re-mounts on store updates, so the value stays fresh
  // without a setInterval.
  const tz       = getUserTZ();
  const todayKey = toDateOnlyUTC(nowUIOnly() as UTCDateTime, tz);
  const isToday  = (dueDate === todayKey);

  // Order matters: a date can be both overdue AND not today (the
  // common case), so check overdue first to avoid the rare "yesterday
  // counted as today" interpretation.
  const overdue = isOverdue(due, nowUIOnly() as UTCDateTime);

  // Jalali display: "DD MMMM" within the current Jalali year ("15 فروردین"),
  // "DD MMMM YYYY" otherwise ("15 فروردین 1405"). Persian month names
  // come from jalaliday's locale data, accessed via toJalaliDisplay.
  const todayJalaliYear = toJalaliDisplay(nowUIOnly() as UTCDateTime, tz, "YYYY");
  const dueJalaliYear   = toJalaliDisplay(due, tz, "YYYY");
  const sameJalaliYear  = todayJalaliYear === dueJalaliYear;
  const dateFormat      = sameJalaliYear ? "D MMMM" : "D MMMM YYYY";
  const dateDisplay     = toJalaliDisplay(due, tz, dateFormat);

  // Tooltip shows the full canonical Jalali date (D14).
  const tooltip = toJalaliDisplay(due, tz, "YYYY/MM/DD");

  // Variant → palette + label
  let palette: string;
  let label:   string;
  let aria:    string;
  if (overdue) {
    palette = "text-red-700 bg-red-50 border border-red-200";
    label   = `منقضی · ${dateDisplay}`;
    aria    = `منقضی شده در ${tooltip}`;
  } else if (isToday) {
    palette = "text-amber-700 bg-amber-50 border border-amber-200";
    label   = "امروز";
    aria    = `سررسید امروز · ${tooltip}`;
  } else {
    palette = "text-slate-700 bg-slate-100 border border-slate-200";
    label   = dateDisplay;
    aria    = `سررسید ${tooltip}`;
  }

  const sizeClasses =
    size === "sm"
      ? "text-[10px] px-1.5 py-0.5 gap-1"
      : "text-xs px-2 py-1 gap-1.5";

  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <span
      role="status"
      aria-label={aria}
      title={tooltip}
      dir="auto"
      className={`inline-flex items-center rounded-full font-medium leading-none ${palette} ${sizeClasses} ${className}`}
    >
      {showIcon ? (
        <Calendar className={iconSize} aria-hidden="true" />
      ) : null}
      <span>{label}</span>
    </span>
  );
}
