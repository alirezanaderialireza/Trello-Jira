"use client";

// apps/web/src/features/shell/sidebar/StarredSection.tsx
//
// "ستاره‌دار" section of the sidebar. Receives the starred board list
// from the bootstrap query and renders a BoardLink for each.
//
// Empty state: "هنوز بوردی را ستاره نکرده‌اید" with a hint that the
// star icon on any board card / sidebar row toggles status. We don't
// CTA-button into board creation here — that's the Workspaces
// section's job.

import { Star } from "lucide-react";

import { BoardLink } from "./BoardLink";

export interface StarredBoardItem {
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceSlug: string;
}

interface StarredSectionProps {
  boards: StarredBoardItem[];
}

export function StarredSection({ boards }: StarredSectionProps) {
  return (
    <section aria-labelledby="sidebar-starred-heading" className="mt-4">
      <h2
        id="sidebar-starred-heading"
        className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        <Star className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
        ستاره‌دار
      </h2>

      {boards.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-slate-400">
          هنوز بوردی را ستاره نکرده‌اید.
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
              isStarred={true}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
