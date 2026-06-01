// apps/web/src/components/checklists/ChecklistProgressBar.tsx
//
// Pure presentational progress bar for a single checklist. Three
// visual states per Master Contract D11/D12/D13:
//
//   • 0 % done      → bar hidden (D13). The header still shows
//                     "۰ از ۵" so the user knows the checklist exists.
//   • 1–99 % done    → linear gradient from emerald-500 to emerald-400
//                     with the percent badge on the start side
//                     (D11; Persian numerals via toPersianNumber).
//   • 100 % done    → solid emerald-500 with a Check icon overlay
//                     and a Persian "تکمیل شد" label (D12).
//
// No state, no hooks, no side effects — Server-Component-friendly.
// The parent computes `done`, `total`, `percent` (via the shared
// `computeProgress` lib) and passes them in.
//
// Lives in shared territory (apps/web/src/components/checklists/)
// per D25 — both `ChecklistSection` (also shared) and any future
// surface that wants to render a checklist progress bar can import
// it without crossing a feature boundary.

import { Check } from "lucide-react";

import { toPersianNumber } from "@/lib/checklists/persianNumerals";

interface Props {
  done:    number;
  total:   number;
  /** Integer percent in [0, 100]. Caller pre-computes via `computeProgress`. */
  percent: number;
  className?: string;
}

export function ChecklistProgressBar({
  done,
  total,
  percent,
  className = "",
}: Props) {
  // Persian copy — caller never has to format. "۳ از ۵" reads
  // naturally right-to-left under dir="rtl" inheritance.
  const ratioLabel  = `${toPersianNumber(done)} از ${toPersianNumber(total)}`;
  const percentLabel = `${toPersianNumber(percent)}٪`;

  // Empty checklist (no items at all) — render only the ratio so
  // the header still aligns with non-empty checklists; no bar.
  if (total === 0) {
    return (
      <div
        role="progressbar"
        aria-valuenow={0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="پیشرفت چک‌لیست"
        className={`flex items-center gap-2 text-xs text-slate-500 ${className}`}
      >
        <span dir="auto">{ratioLabel}</span>
      </div>
    );
  }

  const isComplete = percent >= 100;

  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`پیشرفت چک‌لیست: ${ratioLabel}`}
      className={`flex items-center gap-2 ${className}`}
    >
      {/* Ratio + percent — ratio on the start side, percent on the end side */}
      <span
        dir="auto"
        className={`shrink-0 text-xs font-medium ${
          isComplete ? "text-emerald-600" : "text-slate-600"
        }`}
      >
        {ratioLabel}
      </span>

      {/* The bar itself */}
      <div
        className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className={`absolute inset-y-0 start-0 rounded-full transition-[width] duration-200 ${
            isComplete
              ? "bg-emerald-500"
              : "bg-gradient-to-r from-emerald-500 to-emerald-400"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Trailing indicator */}
      {isComplete ? (
        <span
          aria-hidden="true"
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-emerald-600"
        >
          <Check className="h-3.5 w-3.5" />
          <span>تکمیل شد</span>
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="shrink-0 text-xs font-medium tabular-nums text-slate-500"
        >
          {percentLabel}
        </span>
      )}
    </div>
  );
}
