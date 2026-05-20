// apps/web/src/lib/date.ts
// ─── Jalali-Aware Time Engine ────────────────────────────────────────────────
// Single source of truth for all date/time operations.
// ESLint rule prevents any other file from importing dayjs directly.
// ─────────────────────────────────────────────────────────────────────────────

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import customParseFormat from "dayjs/plugin/customParseFormat";
import jalaliday from "jalaliday/dayjs";

// ============================================================================
// § 0  Plugin Initialization (Idempotent)
// ============================================================================

let _initialized = false;

function ensureInitialized(): void {
  if (_initialized) return;
  dayjs.extend(utc);
  dayjs.extend(timezone);
  dayjs.extend(customParseFormat);
  dayjs.extend(jalaliday);
  _initialized = true;
}

ensureInitialized();

// ============================================================================
// § 1  Branded Types
// ============================================================================

/**
 * A UTC timestamp in ISO-8601 format.
 * Example: "2025-06-15T12:00:00.000Z"
 * Use for: createdAt, updatedAt, occurredAt, all persisted timestamps.
 */
export type UTCDateTime = string & { readonly __brand: "UTCDateTime" };

/**
 * A calendar date without time or timezone.
 * Example: "2025-03-30"
 * Use for: dueDate, invoiceDate, birthDate — anything that is "a day".
 */
export type DateOnly = string & { readonly __brand: "DateOnly" };

/** Tehran timezone identifier. */
export const TEHRAN_TZ = "Asia/Tehran";

/** Default Jalali display format. */
export const JALALI_FMT = "YYYY/MM/DD";

// ============================================================================
// § 2  Result Type (no-throw parsing)
// ============================================================================

export type DateParseError = "INVALID_FORMAT" | "INVALID_JALALI_DATE" | "OUT_OF_RANGE";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DateParseError; input: string };

// ============================================================================
// § 3  getUserTZ()
// ============================================================================

/**
 * Returns the user's IANA timezone from the browser.
 * ⚠️ Do NOT use on the server — returns the server's TZ, not the user's.
 *
 * @example getUserTZ() // "Asia/Tehran" or "Europe/Berlin"
 */
export function getUserTZ(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return TEHRAN_TZ;
  }
}

// ============================================================================
// § 4  nowUIOnly()
// ============================================================================

/**
 * Returns the current UTC time as UTCDateTime.
 * ⚠️ ONLY for UI display (optimistic timestamps, "just now" labels).
 * ⚠️ NEVER for audit, financial, or persisted timestamps — use server time.
 *
 * @example const t = nowUIOnly(); // "2025-06-15T12:00:00.000Z"
 */
export function nowUIOnly(): UTCDateTime {
  return new Date().toISOString() as UTCDateTime;
}

// ============================================================================
// § 5  Server-trusted Factories
// ============================================================================

/**
 * Creates a UTCDateTime from a server-provided ISO string.
 * Throws on invalid input — use only with trusted server data.
 *
 * @example utcFromServer("2025-06-15T12:00:00.000Z")
 * @throws Error if input is not a valid ISO-8601 UTC datetime
 */
export function utcFromServer(iso: string): UTCDateTime {
  if (!iso) throw new Error("utcFromServer: empty input");
  const d = dayjs.utc(iso);
  if (!d.isValid()) throw new Error(`utcFromServer: invalid ISO "${iso}"`);
  return d.toISOString() as UTCDateTime;
}

/**
 * Creates a DateOnly from a server-provided YYYY-MM-DD string.
 * Throws on invalid input — use only with trusted server data.
 *
 * @example dateOnlyFromServer("2025-03-30")
 * @throws Error if input is not YYYY-MM-DD format
 */
export function dateOnlyFromServer(ymd: string): DateOnly {
  if (!ymd) throw new Error("dateOnlyFromServer: empty input");
  const d = dayjs.utc(ymd, "YYYY-MM-DD", true);
  if (!d.isValid()) throw new Error(`dateOnlyFromServer: invalid date "${ymd}"`);
  return d.format("YYYY-MM-DD") as DateOnly;
}

// ============================================================================
// § 6  UTC Math Operations
// ============================================================================

/**
 * Normalizes a UTCDateTime to the start of its UTC day (00:00:00.000Z).
 */
export function normalizeToDayUTC(d: UTCDateTime): UTCDateTime {
  return dayjs.utc(d).startOf("day").toISOString() as UTCDateTime;
}

/**
 * Converts a UTCDateTime to a DateOnly in the given timezone.
 * The "day" depends on the timezone — midnight UTC might be tomorrow in Tehran.
 *
 * @param tz IANA timezone. Default: UTC.
 */
export function toDateOnlyUTC(d: UTCDateTime, tz?: string): DateOnly {
  if (tz) {
    return dayjs.utc(d).tz(tz).format("YYYY-MM-DD") as DateOnly;
  }
  return dayjs.utc(d).format("YYYY-MM-DD") as DateOnly;
}

/**
 * Adds (or subtracts) days to a UTCDateTime.
 *
 * @example addDays(utcFromServer("2025-06-30T10:00:00Z"), 1) // July 1
 */
export function addDays(d: UTCDateTime, days: number): UTCDateTime {
  return dayjs.utc(d).add(days, "day").toISOString() as UTCDateTime;
}

/**
 * Returns the number of calendar days between two dates (a - b).
 * Ignores time-of-day — operates on startOf("day").
 *
 * @example diffDays(june20, june15) // 5
 */
export function diffDays(a: UTCDateTime, b: UTCDateTime): number {
  const da = dayjs.utc(a).startOf("day");
  const db = dayjs.utc(b).startOf("day");
  return da.diff(db, "day");
}

/**
 * Returns true if two UTCDateTimes fall on the same UTC calendar day.
 */
export function isSameDay(a: UTCDateTime, b: UTCDateTime): boolean {
  return dayjs.utc(a).startOf("day").isSame(dayjs.utc(b).startOf("day"));
}

/**
 * Returns true if `target` is strictly before today (UTC).
 * Today itself is NOT overdue.
 *
 * @param now Injectable for testing. Defaults to current time.
 * @example isOverdue(yesterday) // true
 * @example isOverdue(today)     // false
 */
export function isOverdue(target: UTCDateTime | DateOnly, now?: UTCDateTime): boolean {
  const today = dayjs.utc(now ?? new Date().toISOString()).startOf("day");
  const targetDay = dayjs.utc(target).startOf("day");
  return targetDay.isBefore(today);
}

// ============================================================================
// § 7  Jalali Display
// ============================================================================

/**
 * Formats a UTC date/time as Jalali in the given timezone.
 *
 * ⚠️ TRAP: `.calendar('jalali')` on a dayjs instance resets utcOffset to 0.
 * Solution: toggle global calendar default with try/finally (safe: JS is single-threaded).
 *
 * @param date UTCDateTime or DateOnly
 * @param tz   IANA timezone for wall-clock display. Default: TEHRAN_TZ.
 * @param format Jalali format string. Default: JALALI_FMT ("YYYY/MM/DD").
 *
 * @example toJalaliDisplay("2025-03-30T10:30:00Z", "Asia/Tehran") // "1404/01/10"
 * @example toJalaliDisplay("2025-03-30T10:30:00Z", "Asia/Tehran", "YYYY/MM/DD HH:mm") // "1404/01/10 14:00"
 */
export function toJalaliDisplay(
  date: UTCDateTime | DateOnly,
  tz: string = TEHRAN_TZ,
  format: string = JALALI_FMT,
): string {
  // @ts-expect-error — jalaliday extends dayjs with .calendar() but TS doesn't know
  dayjs.calendar("jalali");
  try {
    return dayjs.utc(date).tz(tz).format(format);
  } finally {
    // @ts-expect-error — restore to Gregorian
    dayjs.calendar("gregory");
  }
}

// ============================================================================
// § 8  Jalali Input Parsing (DateOnly)
// ============================================================================

const JALALI_INPUT_REGEX = /^\d{4}\/\d{1,2}\/\d{1,2}$/;

/**
 * Parses a Jalali date string (e.g. "1404/01/10") to a Gregorian DateOnly.
 * Returns a Result — never throws.
 *
 * ⚠️ TRAP: jalaliday silently rolls over invalid dates (1404/12/30 → 1405/01/01).
 * Solution: round-trip validation — format back to Jalali and compare.
 *
 * ⚠️ TRAP: For DateOnly, do NOT apply timezone shift. 1404/01/10 is always 2025-03-30.
 *
 * @example fromJalaliInput("1404/01/10") // { ok: true, value: "2025-03-30" }
 * @example fromJalaliInput("1404/12/30") // { ok: false, error: "INVALID_JALALI_DATE" }
 */
export function fromJalaliInput(input: string): ParseResult<DateOnly> {
  const trimmed = input?.trim();
  if (!trimmed || !JALALI_INPUT_REGEX.test(trimmed)) {
    return { ok: false, error: "INVALID_FORMAT", input: input ?? "" };
  }

  // Pad single-digit month/day: 1404/1/5 → 1404/01/05
  const parts = trimmed.split("/");
  const normalized = `${parts[0]}/${parts[1]!.padStart(2, "0")}/${parts[2]!.padStart(2, "0")}`;

  // Parse in Jalali calendar context
  // @ts-expect-error — jalaliday calendar API
  dayjs.calendar("jalali");
  let candidate: dayjs.Dayjs;
  try {
    candidate = dayjs(normalized, JALALI_FMT, true);
    if (!candidate.isValid()) {
      return { ok: false, error: "INVALID_JALALI_DATE", input };
    }

    // Round-trip validation: format back to Jalali and compare
    const roundTrip = candidate.format(JALALI_FMT);
    if (roundTrip !== normalized) {
      return { ok: false, error: "INVALID_JALALI_DATE", input };
    }

    // Convert to Gregorian DateOnly — NO timezone shift!
    // @ts-expect-error — restore calendar
    dayjs.calendar("gregory");
    const gregDate = candidate.format("YYYY-MM-DD");
    return { ok: true, value: gregDate as DateOnly };
  } catch {
    return { ok: false, error: "INVALID_JALALI_DATE", input };
  } finally {
    // @ts-expect-error — ensure restore
    dayjs.calendar("gregory");
  }
}

// ============================================================================
// § 9  Jalali DateTime Input (with timezone → UTCDateTime)
// ============================================================================

const JALALI_DATETIME_REGEX = /^\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}$/;

/**
 * Parses a Jalali datetime string (e.g. "1404/01/10 14:00") to UTCDateTime.
 * The time is interpreted as wall-clock in the given timezone (default: Tehran).
 *
 * @param tz IANA timezone for interpreting the input time. Default: TEHRAN_TZ.
 *
 * @example fromJalaliDateTimeInput("1404/01/10 14:00", "Asia/Tehran")
 *   // { ok: true, value: "2025-03-30T10:30:00.000Z" }
 */
export function fromJalaliDateTimeInput(
  input: string,
  tz: string = TEHRAN_TZ,
): ParseResult<UTCDateTime> {
  const trimmed = input?.trim();
  if (!trimmed || !JALALI_DATETIME_REGEX.test(trimmed)) {
    return { ok: false, error: "INVALID_FORMAT", input: input ?? "" };
  }

  const [datePart, timePart] = trimmed.split(/\s+/);
  const parts = datePart!.split("/");
  const normalizedDate = `${parts[0]}/${parts[1]!.padStart(2, "0")}/${parts[2]!.padStart(2, "0")}`;
  const fullNormalized = `${normalizedDate} ${timePart}`;

  // @ts-expect-error — jalaliday calendar API
  dayjs.calendar("jalali");
  try {
    const candidate = dayjs(fullNormalized, "YYYY/MM/DD HH:mm", true);
    if (!candidate.isValid()) {
      return { ok: false, error: "INVALID_JALALI_DATE", input };
    }

    // Round-trip validation (date part only)
    const roundTrip = candidate.format(JALALI_FMT);
    if (roundTrip !== normalizedDate) {
      return { ok: false, error: "INVALID_JALALI_DATE", input };
    }

    // Convert to Gregorian, apply timezone, then UTC
    // @ts-expect-error — restore calendar
    dayjs.calendar("gregory");
    const gregString = candidate.format("YYYY-MM-DD HH:mm");
    const withTz = dayjs.tz(gregString, "YYYY-MM-DD HH:mm", tz);
    return { ok: true, value: withTz.utc().toISOString() as UTCDateTime };
  } catch {
    return { ok: false, error: "INVALID_JALALI_DATE", input };
  } finally {
    // @ts-expect-error — ensure restore
    dayjs.calendar("gregory");
  }
}
