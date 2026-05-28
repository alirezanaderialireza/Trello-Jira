"use client";

// apps/web/src/components/labels/CreateLabelForm.tsx
//
// Presentational form for "create a new label". Used by both the
// LabelPicker (collapsed under a "+ ساخت برچسب جدید" CTA) and the
// LabelManager (expanded inline above the manager list).
//
// Owns NO data fetching and NO mutation calls — the parent passes
// everything in:
//   • existingNames        — current board labels (live names) for the
//                            client-side duplicate check, mirroring
//                            the server's case-insensitive fa-IR fold.
//   • isSubmitting         — drives the submit button label + disabled
//                            state during the optimistic mutation.
//   • errorMessage         — Persian text rendered under the input
//                            when the parent's mutation rolled back
//                            (e.g. server returned CONFLICT after a
//                            race past the local duplicate check).
//   • defaultColorToken    — pre-select a swatch (defaults to blue).
//   • onSubmit             — fired with the validated values.
//   • onCancel?            — optional close handler (Picker only;
//                            Manager just collapses on submit).
//
// D10 RTL: the grid renders in document order; the page-level dir="rtl"
// makes swatch #0 (red) appear visually on the right. No extra CSS
// needed — Tailwind's `grid-cols-4` honours the writing direction.

import { useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";

import type { ColorToken } from "@repo/domain";

import { COLOR_TOKENS } from "@/lib/labels/persianLabels";
import { getTokenStyle } from "@/lib/labels/tokenColorMap";

const MAX_NAME_LENGTH = 50;
const DEFAULT_TOKEN: ColorToken = "blue.500";

export interface CreateLabelFormSubmitValues {
  name: string;
  colorToken: ColorToken;
}

interface Props {
  existingNames:    readonly string[];
  isSubmitting?:    boolean;
  errorMessage?:    string | null;
  defaultColorToken?: ColorToken;
  onSubmit:         (values: CreateLabelFormSubmitValues) => void;
  onCancel?:        () => void;
  /** Auto-focus the name input on mount. Default true. */
  autoFocus?:       boolean;
}

export function CreateLabelForm({
  existingNames,
  isSubmitting = false,
  errorMessage = null,
  defaultColorToken = DEFAULT_TOKEN,
  onSubmit,
  onCancel,
  autoFocus = true,
}: Props) {
  const nameInputId = useId();
  const colorGroupId = useId();

  const [name, setName] = useState("");
  const [colorToken, setColorToken] = useState<ColorToken>(defaultColorToken);
  // Local validation error (string | null). The parent's `errorMessage`
  // prop covers server-rejection toasts that came back AFTER submit;
  // this state covers the inline pre-submit hints.
  const [localError, setLocalError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      // queueMicrotask defers the focus past the parent's mount,
      // matching the F5a DeleteWorkspaceDialog pattern.
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [autoFocus]);

  // Pre-compute the lower-cased existing names once per render. Mirrors
  // the server's `toLocaleLowerCase("fa-IR")` fold so a name that the
  // client thinks is unique is also unique on the wire (saves a round-
  // trip to discover the CONFLICT).
  const existingLower = existingNames.map((n) =>
    n.trim().toLocaleLowerCase("fa-IR"),
  );

  function validate(): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0) return "نام برچسب را وارد کنید.";
    if (trimmed.length > MAX_NAME_LENGTH) {
      return `نام برچسب نباید از ${MAX_NAME_LENGTH} نویسه بیشتر باشد.`;
    }
    const lower = trimmed.toLocaleLowerCase("fa-IR");
    if (existingLower.includes(lower)) {
      return "این نام برچسب قبلاً وجود دارد.";
    }
    return null;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;
    const error = validate();
    if (error) {
      setLocalError(error);
      inputRef.current?.focus();
      return;
    }
    setLocalError(null);
    onSubmit({ name: name.trim(), colorToken });
    // Reset for the next entry. Parent decides whether to keep the
    // form open (Picker collapses; Manager re-opens for batch entry
    // by remounting).
    setName("");
    setColorToken(defaultColorToken);
  }

  // Surface either the parent's server-side error OR our local
  // pre-submit hint (parent wins because it represents a known reality).
  const displayError = errorMessage ?? localError;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name input */}
      <div>
        <label
          htmlFor={nameInputId}
          className="mb-1.5 block text-sm font-medium text-slate-900"
        >
          نام برچسب
        </label>
        <input
          id={nameInputId}
          ref={inputRef}
          type="text"
          dir="auto"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            // Optimistically clear an inline error when the user
            // starts typing again — the parent's server error stays
            // until the next submit.
            if (localError) setLocalError(null);
          }}
          maxLength={MAX_NAME_LENGTH + 4} // wiggle room for visual feedback past hard limit
          disabled={isSubmitting}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={displayError ? "true" : "false"}
          aria-describedby={displayError ? `${nameInputId}-error` : undefined}
          placeholder="مثال: رفع باگ"
          className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-100"
        />
        {displayError ? (
          <p
            id={`${nameInputId}-error`}
            role="alert"
            className="mt-1.5 text-xs text-red-600"
          >
            {displayError}
          </p>
        ) : null}
      </div>

      {/* Colour swatch grid */}
      <fieldset disabled={isSubmitting} className="space-y-2">
        <legend
          id={colorGroupId}
          className="block text-sm font-medium text-slate-900"
        >
          رنگ برچسب
        </legend>
        {/*
          radiogroup over a plain grid — keyboard navigation between
          radios is browser-default (Arrow keys), and a single roving
          tabIndex keeps the swatches off the Tab cycle past the first
          one. The selected swatch always has tabIndex=0 so Shift+Tab
          from the submit button lands back on the active colour.
        */}
        <div
          role="radiogroup"
          aria-labelledby={colorGroupId}
          className="grid grid-cols-4 gap-2"
        >
          {COLOR_TOKENS.map((token) => {
            const style = getTokenStyle(token);
            const isSelected = token === colorToken;
            return (
              <button
                key={token}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={style.persianName}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setColorToken(token)}
                onKeyDown={(event) => {
                  // Arrow keys move selection; Space/Enter is the
                  // browser-default click on a button.
                  if (
                    event.key !== "ArrowRight" &&
                    event.key !== "ArrowLeft" &&
                    event.key !== "ArrowUp" &&
                    event.key !== "ArrowDown"
                  ) {
                    return;
                  }
                  event.preventDefault();
                  const idx = COLOR_TOKENS.indexOf(token);
                  // Logical horizontal mirror under RTL: ArrowRight
                  // moves visually right, which is sourceOrder - 1.
                  // Up/Down step by 4 (column count).
                  const delta =
                    event.key === "ArrowRight"
                      ? -1
                      : event.key === "ArrowLeft"
                      ? +1
                      : event.key === "ArrowUp"
                      ? -4
                      : +4;
                  const next =
                    (idx + delta + COLOR_TOKENS.length) % COLOR_TOKENS.length;
                  setColorToken(COLOR_TOKENS[next] as ColorToken);
                }}
                title={style.persianName}
                className={`relative flex h-10 items-center justify-center rounded-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 ${
                  isSelected
                    ? "ring-2 ring-offset-2 ring-blue-500"
                    : "hover:scale-105"
                }`}
                style={{
                  backgroundColor: style.bg,
                  color:           style.text,
                }}
              >
                {isSelected ? (
                  <Check className="h-5 w-5" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Submit + cancel */}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting || name.trim().length === 0}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "در حال ایجاد..." : "ایجاد"}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            انصراف
          </button>
        ) : null}
      </div>
    </form>
  );
}
