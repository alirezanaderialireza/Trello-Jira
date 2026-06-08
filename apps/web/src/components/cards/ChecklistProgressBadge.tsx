// apps/web/src/components/cards/ChecklistProgressBadge.tsx
//
// Pure presentational badge showing checklist progress for a card.
// Lives in shared territory (src/components/cards/) — mirrors the
// D21 resolution from labels-conventions.md:
//   • CardItem (features/board) consumes it.
//   • The boundaries linter blocks feature→feature imports.
//   • Moving it to shared (feature→shared is allowed) fixes the lint.
//
// The value is derived by the consumer via an atomic store selector
// and passed in as props — this component has no store reads.
// This keeps the badge pure and maximally reusable.
//
// Renders nothing when total === 0 (no checklists with items).

import { CheckSquare } from "lucide-react";

interface Props {
  /** Total number of checklist items across all checklists on the card. */
  total: number;
  /** Number of completed (isDone) items. */
  done:  number;
  className?: string;
}

export function ChecklistProgressBadge({ total, done, className = "" }: Props) {
  if (total === 0) return null;

  const allDone  = done === total;
  const doneFa   = done.toLocaleString("fa-IR");
  const totalFa  = total.toLocaleString("fa-IR");
  const ariaText = `چک‌لیست‌ها: ${doneFa} از ${totalFa} مورد تکمیل شده`;

  return (
    <span
      role="status"
      aria-label={ariaText}
      title={ariaText}
      dir="ltr"
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums ${
        allDone
          ? "bg-emerald-900/50 text-emerald-400"
          : "bg-slate-700 text-slate-400"
      } ${className}`}
    >
      <CheckSquare className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      <span>{doneFa}/{totalFa}</span>
    </span>
  );
}
