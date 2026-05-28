"use client";

// apps/web/src/features/shell/sidebar/RecentSection.tsx
//
// "آخرین بازدیدها" section of the sidebar. Top-5 most recently viewed
// boards (server-side ordering by last_viewed_at DESC, capped to 5
// per the F3b sidebar.bootstrap contract).
//
// Each row uses BoardLink with a `secondaryText` showing the relative
// time in Persian ("۲ روز پیش"). Date formatting goes through
// `lib/date.ts` so we never touch dayjs directly — see the steering
// rule in date-engine.md.
//
// Empty state: simple Persian message. New users will see this until
// they visit their first board, which records a view via
// userBoardMetadata.recordView (handled by board page mount in a
// separate phase).

import { Clock } from "lucide-react";

import { toJalaliDisplay, type UTCDateTime } from "../../../lib/date";
import { BoardLink } from "./BoardLink";

export interface RecentBoardItem {
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceSlug: string;
  lastViewedAt: string; // ISO-8601 UTC
}

interface RecentSectionProps {
  boards: RecentBoardItem[];
  /**
   * Optional set of boardIds that are starred — used to forward the
   * star state to BoardLink so the toggle starts in the right
   * position. Computed by the parent Sidebar from the bootstrap
   * starredBoards array.
   */
  starredBoardIds: Set<string>;
  /** User's IANA timezone, used for jalali display. */
  userTimezone: string;
}

/**
 * Format a UTC ISO timestamp as a short Persian "MM/DD" Jalali label.
 * The full date with time is available on hover via the title prop in
 * BoardLink. We keep the visible label compact to fit alongside the
 * board title in a 240px sidebar column.
 */
function formatRecentLabel(iso: string, tz: string): string {
  try {
    return toJalaliDisplay(iso as UTCDateTime, tz, "MM/DD");
  } catch {
    return "";
  }
}

export function RecentSection({
  boards,
  starredBoardIds,
  userTimezone,
}: RecentSectionProps) {
  return (
    <section aria-labelledby="sidebar-recent-heading" className="mt-4">
      <h2
        id="sidebar-recent-heading"
        className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        آخرین بازدیدها
      </h2>

      {boards.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-slate-400">
          هنوز بوردی را باز نکرده‌اید.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {boards.map((b) => (
            <BoardLink
              key={b.boardId}
              boardId={b.boardId}
              boardTitle={b.boardTitle}
              workspaceId={b.workspaceId}
              workspaceSlug={b.workspaceSlug}
              isStarred={starredBoardIds.has(b.boardId)}
              secondaryText={formatRecentLabel(b.lastViewedAt, userTimezone)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
