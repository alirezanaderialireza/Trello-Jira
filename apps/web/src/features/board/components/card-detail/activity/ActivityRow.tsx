"use client";

// apps/web/src/features/board/components/card-detail/activity/ActivityRow.tsx
//
// Phase 1.2 (F1.2.6) — renders a single activity entry.
//
// Layout (RTL): avatar | text + relative time
//
// actor resolution priority:
//   1. entry.actorName (server-enriched)
//   2. boardMembers[entry.actorId]?.displayName (local cache)
//   3. «کاربر»

import type { ActivityEntry } from "../../../store/useBoardStore";
import type { BoardMemberDto } from "@/lib/members/types";
import { UserAvatar }          from "@/components/users/UserAvatar";
import { formatRelative, formatAbsolute } from "@/lib/relativeTime";
import { formatActivityText }  from "@/lib/activity/formatActivityText";

interface Props {
  entry:        ActivityEntry;
  boardMembers: Record<string, BoardMemberDto>;
}

export function ActivityRow({ entry, boardMembers }: Props) {
  // Resolve actor display name and avatar.
  const memberFromCache = boardMembers[entry.actorId];
  const actorName  = entry.actorName  ?? memberFromCache?.displayName ?? "کاربر";
  const actorAvatar = entry.actorAvatar ?? memberFromCache?.avatarUrl  ?? null;

  // Forward enrichment fields so the formatter can read them from payload.
  const enrichedEntry = {
    ...entry,
    actorName,
    payload: {
      ...entry.payload,
    },
  };

  const text = formatActivityText(enrichedEntry);

  return (
    <div dir="rtl" className="flex gap-2.5 items-start py-1.5 group">
      {/* Actor avatar */}
      <div className="mt-0.5 flex-shrink-0">
        <UserAvatar
          displayName={actorName}
          avatarUrl={actorAvatar}
          size="sm"
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-300 leading-relaxed">
          {text}
        </p>
        <time
          dateTime={entry.timestamp}
          title={formatAbsolute(entry.timestamp)}
          className="text-[11px] text-slate-500 mt-0.5 block"
        >
          {formatRelative(entry.timestamp)}
        </time>
      </div>
    </div>
  );
}
