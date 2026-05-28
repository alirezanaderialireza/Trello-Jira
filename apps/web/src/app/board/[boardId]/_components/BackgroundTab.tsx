"use client";

// apps/web/src/app/board/[boardId]/_components/BackgroundTab.tsx
//
// Color + gradient picker with hover-driven live preview.
//
// Live preview mechanism (per the user's refinement of D3):
//   The parent page mounts a BoardBackgroundController (commit 8)
//   that sets `document.body.style.setProperty('--board-bg', ...)`
//   on first paint. The board canvas renders with
//   `style={{ background: 'var(--board-bg, ...)' }}`.
//
//   This tab WRITES to the same CSS variable on hover so the user
//   sees the candidate background applied to the live board behind
//   the drawer in real time. On mouse-leave (or commit failure),
//   the variable is restored to the persisted value via a ref that
//   tracks the latest known-persisted CSS.
//
//   On unmount (tab switch / drawer close / escape), the cleanup
//   effect restores the persisted value too — guarantees no
//   stranded preview if the user moves to another tab without
//   committing.
//
// Click commits via the setBackground Server Action; the persisted
// ref is then updated to the new value so future revert paths (and
// future tab-mounts) read the right baseline.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";

import { trpc } from "../../../../utils/trpc";
import {
  BOARD_BG_CSS_VAR,
  isBackgroundData,
  previewCssFor,
  renderBackgroundCss,
} from "../../../../features/board-settings/lib/applyBackground";
import {
  COLOR_PRESETS,
  GRADIENT_PRESETS,
  type BackgroundType,
  type ColorPreset,
  type GradientPreset,
} from "../../../../features/board-settings/lib/backgroundPresets";

import type { ActionResult } from "../_actions/_helpers";

interface Props {
  boardId: string;
  backgroundData: unknown;
  role: "OWNER" | "ADMIN" | "MEMBER";
  onSetBackground: (input: {
    boardId: string;
    backgroundData: { type: "color" | "gradient"; id: string } | null;
  }) => Promise<ActionResult>;
}

export function BackgroundTab({
  boardId,
  backgroundData,
  role,
  onSetBackground,
}: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const persistedData = isBackgroundData(backgroundData) ? backgroundData : null;
  const persistedCss = renderBackgroundCss(persistedData);

  // Mutable ref tracks the latest persisted CSS — used by the
  // hover-leave + cleanup paths to revert without a stale closure
  // capture. Sync it after every persistedCss change.
  const persistedRef = useRef(persistedCss);
  useEffect(() => {
    persistedRef.current = persistedCss;
  }, [persistedCss]);

  // Cleanup on unmount — restore the persisted CSS so a stranded
  // preview doesn't survive a tab switch or drawer close.
  useEffect(() => {
    return () => {
      document.body.style.setProperty(BOARD_BG_CSS_VAR, persistedRef.current);
    };
  }, []);

  const [activeSection, setActiveSection] = useState<BackgroundType>(
    persistedData?.type ?? "color",
  );
  const [isCommitting, startCommit] = useTransition();

  const canEdit = role === "OWNER" || role === "ADMIN";

  const handleHover = (type: BackgroundType, id: string) => {
    if (!canEdit) return;
    document.body.style.setProperty(BOARD_BG_CSS_VAR, previewCssFor(type, id));
  };

  const handleLeave = () => {
    if (!canEdit) return;
    document.body.style.setProperty(BOARD_BG_CSS_VAR, persistedRef.current);
  };

  const handleCommit = (type: BackgroundType, id: string) => {
    if (!canEdit || isCommitting) return;
    // Anti-duplicate: clicking the already-active swatch is a no-op.
    if (
      persistedData &&
      persistedData.type === type &&
      persistedData.id === id
    ) {
      return;
    }
    startCommit(async () => {
      const result = await onSetBackground({
        boardId,
        backgroundData: { type, id },
      });
      if (result.ok) {
        toast.success("پس‌زمینهٔ بورد به‌روزرسانی شد.");
        // Update the persisted reference so subsequent reverts use the
        // new value. The actual CSS is already applied via the hover
        // handler — leaving it as-is is correct (no flicker).
        persistedRef.current = previewCssFor(type, id);
        await utils.v1.public.boardManagement.getBoardSettings.invalidate({
          boardId,
        });
        router.refresh();
      } else {
        // Revert the live preview on failure.
        document.body.style.setProperty(BOARD_BG_CSS_VAR, persistedRef.current);
        toast.error(result.error ?? "خطا در تغییر پس‌زمینه.");
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Section nav: رنگ | گرادیان */}
      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            { id: "color" as const, label: "رنگ" },
            { id: "gradient" as const, label: "گرادیان" },
          ]
        ).map((section) => {
          const isActive = section.id === activeSection;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              aria-current={isActive ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                isActive
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {section.label}
            </button>
          );
        })}
      </div>

      {/* Swatch grid */}
      {activeSection === "color" ? (
        <div className="grid grid-cols-4 gap-2">
          {COLOR_PRESETS.map((preset) => (
            <ColorSwatch
              key={preset.id}
              preset={preset}
              isActive={
                persistedData?.type === "color" &&
                persistedData.id === preset.id
              }
              disabled={!canEdit || isCommitting}
              onHover={() => handleHover("color", preset.id)}
              onLeave={handleLeave}
              onClick={() => handleCommit("color", preset.id)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {GRADIENT_PRESETS.map((preset) => (
            <GradientSwatch
              key={preset.id}
              preset={preset}
              isActive={
                persistedData?.type === "gradient" &&
                persistedData.id === preset.id
              }
              disabled={!canEdit || isCommitting}
              onHover={() => handleHover("gradient", preset.id)}
              onLeave={handleLeave}
              onClick={() => handleCommit("gradient", preset.id)}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] leading-6 text-slate-400">
        برای پیش‌نمایش روی یک گزینه نشانگر را نگه دارید؛ برای ثبت کلیک کنید.
      </p>

      {!canEdit && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-500">
          فقط مدیران و مالک بورد می‌توانند پس‌زمینه را تغییر دهند.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface SwatchHandlers {
  isActive: boolean;
  disabled: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
}

function ColorSwatch({
  preset,
  ...rest
}: { preset: ColorPreset } & SwatchHandlers) {
  return (
    <SwatchButton
      style={{ background: preset.hsl }}
      label={preset.name}
      {...rest}
    />
  );
}

function GradientSwatch({
  preset,
  ...rest
}: { preset: GradientPreset } & SwatchHandlers) {
  return (
    <SwatchButton
      style={{ background: preset.gradientCss }}
      label={preset.name}
      {...rest}
    />
  );
}

function SwatchButton({
  style,
  label,
  isActive,
  disabled,
  onHover,
  onLeave,
  onClick,
}: {
  style: React.CSSProperties;
  label: string;
} & SwatchHandlers) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onFocus={onHover}
      onBlur={onLeave}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={isActive}
      title={label}
      style={style}
      className={`group relative aspect-[4/3] overflow-hidden rounded-lg border transition-all ${
        isActive
          ? "border-blue-600 ring-2 ring-blue-200"
          : "border-slate-200 hover:border-slate-400"
      } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      {isActive && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-white/90 p-1 shadow">
            <Check className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
          </span>
        </span>
      )}
      {/* Persian name overlay shown on hover (desktop) and always on
          smaller swatches for legibility. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent px-2 py-1 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {label}
      </span>
    </button>
  );
}
