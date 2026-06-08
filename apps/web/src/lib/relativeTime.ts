// apps/web/src/lib/relativeTime.ts
//
// Persian relative + absolute time formatting for the Comments UI (F1.2.4.b).
//
// Rules:
//   < 60 s     → «الان»
//   < 60 min   → «N دقیقه پیش»
//   < 24 h     → «N ساعت پیش»
//   < 2 days   → «دیروز»
//   < 7 days   → «N روز پیش»
//   ≥ 7 days   → absolute Jalali date (toJalaliDisplay)
//
// All numbers use fa-IR locale (toLocaleString("fa-IR")).
// All date operations go through @/lib/date — no direct dayjs.
// nowUIOnly() is used for the "now" reference — documented exception
// in date-engine.md ("for display only — never persist it").

import {
  getUserTZ,
  nowUIOnly,
  toJalaliDisplay,
  type UTCDateTime,
} from "@/lib/date";

const MINUTE = 60;
const HOUR   = 60 * MINUTE;
const DAY    = 24 * HOUR;
const WEEK   = 7  * DAY;

/** fa-IR numeral helper */
function fa(n: number): string {
  return n.toLocaleString("fa-IR");
}

/**
 * Returns a Persian relative string for `utcDate`.
 * `now` defaults to `nowUIOnly()` — injectable for tests.
 */
export function formatRelative(utcDate: string, now?: string): string {
  const nowIso   = now ?? nowUIOnly();
  const diffMs   = new Date(nowIso).getTime() - new Date(utcDate).getTime();
  const diffSec  = Math.max(0, Math.floor(diffMs / 1000));

  if (diffSec < MINUTE)      return "الان";
  if (diffSec < HOUR)        return `${fa(Math.floor(diffSec / MINUTE))} دقیقه پیش`;
  if (diffSec < DAY)         return `${fa(Math.floor(diffSec / HOUR))} ساعت پیش`;
  if (diffSec < 2 * DAY)     return "دیروز";
  if (diffSec < WEEK)        return `${fa(Math.floor(diffSec / DAY))} روز پیش`;

  return formatAbsolute(utcDate);
}

/**
 * Returns a full Jalali display string for `utcDate`.
 * Uses `toJalaliDisplay` from the date engine.
 */
export function formatAbsolute(utcDate: string): string {
  const tz = getUserTZ();
  return toJalaliDisplay(utcDate as UTCDateTime, tz, "D MMMM YYYY، HH:mm");
}
