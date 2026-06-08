"use client";

// apps/web/src/features/board/components/card-detail/CardCover.tsx
//
// Phase 1.2 (F1.2.7) — Card Cover picker.
// Inline card-detail section (not a popup). Shows color + gradient grids.
// Image cover placeholder (disabled) shown for F1.2.8.

import { useMemo } from "react";

import { useBoardStore }                 from "../../store/useBoardStore";
import { useSetCardCover }               from "../../store/mutations/cards/useSetCardCover";
import {
  COLOR_PRESETS,
  GRADIENT_PRESETS,
  renderBackgroundCss,
  isBackgroundData,
} from "@/lib/background";

interface Props {
  cardId:  string;
  boardId: string;
}

export function CardCover({ cardId, boardId }: Props) {
  const coverData = useBoardStore(
    useMemo(() => (s: any) => s.cards[cardId]?.coverData ?? null, [cardId]),
  ) as { type: string; id: string } | null;

  const setCover = useSetCardCover();

  function handleSet(type: "color" | "gradient", id: string) {
    setCover.mutate({ cardId, boardId, coverData: { type, id }, correlationId: crypto.randomUUID() });
  }

  function handleClear() {
    setCover.mutate({ cardId, boardId, coverData: null, correlationId: crypto.randomUUID() });
  }

  return (
    <div dir="rtl">
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
        پوشش کارت
      </h3>

      {/* Current cover preview */}
      {isBackgroundData(coverData) ? (
        <div
          className="mb-3 h-10 w-full rounded-lg"
          style={{ background: renderBackgroundCss(coverData) }}
          aria-label="پوشش فعلی کارت"
        />
      ) : null}

      {/* Color swatches */}
      <p className="mb-1.5 text-[11px] text-slate-500">رنگ</p>
      <div className="mb-3 grid grid-cols-6 gap-1.5">
        {COLOR_PRESETS.map((preset) => {
          const isActive = coverData?.type === "color" && coverData?.id === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              title={preset.name}
              aria-label={`پوشش ${preset.name}`}
              aria-pressed={isActive}
              onClick={() => handleSet("color", preset.id)}
              disabled={setCover.isPending}
              className={`h-8 w-full rounded-md transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 ${
                isActive ? "ring-2 ring-white" : "hover:ring-2 hover:ring-white/50"
              }`}
              style={{ background: preset.hsl }}
            />
          );
        })}
      </div>

      {/* Gradient swatches */}
      <p className="mb-1.5 text-[11px] text-slate-500">گرادیان</p>
      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {GRADIENT_PRESETS.map((preset) => {
          const isActive = coverData?.type === "gradient" && coverData?.id === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              title={preset.name}
              aria-label={`پوشش ${preset.name}`}
              aria-pressed={isActive}
              onClick={() => handleSet("gradient", preset.id)}
              disabled={setCover.isPending}
              className={`h-8 w-full rounded-md transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 ${
                isActive ? "ring-2 ring-white" : "hover:ring-2 hover:ring-white/50"
              }`}
              style={{ background: preset.gradientCss }}
            />
          );
        })}
      </div>

      {/* Image placeholder — F1.2.8 */}
      <button
        type="button"
        disabled
        className="mb-3 w-full cursor-not-allowed rounded-md border border-dashed border-slate-600 py-2 text-xs text-slate-500"
        aria-label="آپلود تصویر (به زودی)"
      >
        📎 تصویر (به زودی — نیاز به آپلود فایل)
      </button>

      {/* Clear */}
      {isBackgroundData(coverData) ? (
        <button
          type="button"
          onClick={handleClear}
          disabled={setCover.isPending}
          className="w-full rounded-md border border-slate-600 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {setCover.isPending ? "در حال حذف..." : "حذف پوشش"}
        </button>
      ) : null}
    </div>
  );
}
