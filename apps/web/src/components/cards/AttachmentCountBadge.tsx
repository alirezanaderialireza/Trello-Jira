// apps/web/src/components/cards/AttachmentCountBadge.tsx
//
// Shared badge (src/components/cards/) — attachment count on CardItem.
// Lives in shared territory per D21 (boundaries linter blocks feature→feature).
// Renders nothing when count === 0.

import { Paperclip } from "lucide-react";

interface Props {
  count:     number;
  className?: string;
}

export function AttachmentCountBadge({ count, className = "" }: Props) {
  if (!count || count === 0) return null;

  const countFa  = count.toLocaleString("fa-IR");
  const ariaText = `${countFa} پیوست`;

  return (
    <span
      role="status"
      aria-label={ariaText}
      title={ariaText}
      className={`inline-flex items-center gap-1 rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium leading-none text-slate-400 tabular-nums ${className}`}
    >
      <Paperclip className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      <span>{countFa}</span>
    </span>
  );
}
