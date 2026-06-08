// apps/web/src/components/cards/CardCommentsBadge.tsx
//
// Pure presentational badge showing comment count for a card preview.
// Lives in shared territory (src/components/cards/) — same D21 pattern
// as CardDueDateBadge and ChecklistProgressBadge.
//
// CardItem (features/board) consumes it via an atomic store selector.
// The boundaries linter blocks feature→feature imports, so this must
// be in shared.
//
// Renders nothing when total === 0.

import { MessageSquare } from "lucide-react";

interface Props {
  count:     number;
  className?: string;
}

export function CardCommentsBadge({ count, className = "" }: Props) {
  if (count === 0) return null;

  const countFa  = count.toLocaleString("fa-IR");
  const ariaText = `${countFa} کامنت`;

  return (
    <span
      role="status"
      aria-label={ariaText}
      title={ariaText}
      className={`inline-flex items-center gap-1 rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium leading-none text-slate-400 tabular-nums ${className}`}
    >
      <MessageSquare className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      <span>{countFa}</span>
    </span>
  );
}
