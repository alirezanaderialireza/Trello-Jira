"use client";

// apps/web/src/features/labels/components/EditLabelForm.tsx
//
// Inline edit form for a single label. Used by LabelManager (D9: edit
// expands the row in place, not a separate modal). Structurally a
// twin of CreateLabelForm, but:
//   • Pre-filled from the label being edited.
//   • Save button is disabled when nothing changed (no-op short-
//     circuit; the server's update use case also returns noOp:true,
//     so this is purely a UX-saver to skip the round trip).
//   • Cancel is always present (Manager collapses the row on cancel).
//   • Duplicate detection ignores the label's own current name —
//     parent passes `existingNames` already filtered.
//
// The form does NOT call the mutation directly. Parent owns the
// useUpdateLabel() hook and wires `onSubmit` + `isSubmitting`.

import { useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";

import type { ColorToken } from "@repo/domain";

import { COLOR_TOKENS, isKnownColorToken } from "@/lib/labels/persianLabels";
import { getTokenStyle } from "@/lib/labels/tokenColorMap";

const MAX_NAME_LENGTH = 50;

export interface EditLabelFormSubmitValues {
  name: string;
  colorToken: ColorToken;
}

interface Props {
  /** The label being edited. `colorToken` is the wire-level string. */
  label: { id: string; name: string; colorToken: string };
  /** Other live-label names on the board, **excluding** this label's. */
  existingNames: readonly string[];
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onSubmit:      (values: EditLabelFormSubmitValues) => void;
  onCancel:      () => void;
}

export function EditLabelForm({
  label,
  existingNames,
  isSubmitting = false,
  errorMessage = null,
  onSubmit,
  onCancel,
}: Props) {
  const nameInputId = useId();
  const colorGroupId = useId();

  // Resolve the initial colour token defensively. If a future migration
  // introduces a token this client doesn't yet know, fall back to blue
  // so the form still renders — the user can re-pick a known colour.
  const initialColorToken: ColorToken = isKnownColorToken(label.colorToken)
    ? label.colorToken
    : "blue.500";

  const [name, setName]             = useState(label.name);
  const [colorToken, setColorToken] = useState<ColorToken>(initialColorToken);
  const [localError, setLocalError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queueMicrotask(() => inputRef.current?.focus());
  }, []);

  const trimmedName    = name.trim();
  const isDirty        =
    trimmedName !== label.name.trim() || colorToken !== initialColorToken;

  const existingLower = existingNames.map((n) =>
    n.trim().toLocaleLowerCase("fa-IR"),
  );

  function validate(): string | null {
    if (trimmedName.length === 0) return "نام برچسب را وارد کنید.";
    if (trimmedName.length > MAX_NAME_LENGTH) {
      return `نام برچسب نباید از ${MAX_NAME_LENGTH} نویسه بیشتر باشد.`;
    }
    const lower = trimmedName.toLocaleLowerCase("fa-IR");
    if (existingLower.includes(lower)) {
      return "این نام برچسب قبلاً وجود دارد.";
    }
    return null;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;

    // No-op short-circuit: nothing changed → close without round-trip.
    if (!isDirty) {
      onCancel();
      return;
    }

    const error = validate();
    if (error) {
      setLocalError(error);
      inputRef.current?.focus();
      return;
    }
    setLocalError(null);
    onSubmit({ name: trimmedName, colorToken });
  }

  // Esc cancels — matches the F5b drawer convention.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) {
        event.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSubmitting, onCancel]);

  const displayError = errorMessage ?? localError;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label
          htmlFor={nameInputId}
          className="mb-1.5 block text-xs font-medium text-slate-700"
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
            if (localError) setLocalError(null);
          }}
          maxLength={MAX_NAME_LENGTH + 4}
          disabled={isSubmitting}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={displayError ? "true" : "false"}
          aria-describedby={displayError ? `${nameInputId}-error` : undefined}
          className="block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-100"
        />
        {displayError ? (
          <p
            id={`${nameInputId}-error`}
            role="alert"
            className="mt-1 text-xs text-red-600"
          >
            {displayError}
          </p>
        ) : null}
      </div>

      <fieldset disabled={isSubmitting} className="space-y-1.5">
        <legend
          id={colorGroupId}
          className="block text-xs font-medium text-slate-700"
        >
          رنگ
        </legend>
        <div
          role="radiogroup"
          aria-labelledby={colorGroupId}
          className="grid grid-cols-6 gap-1.5"
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
                  // 6-column grid: vertical step is 6, horizontal mirrors RTL.
                  const delta =
                    event.key === "ArrowRight"
                      ? -1
                      : event.key === "ArrowLeft"
                      ? +1
                      : event.key === "ArrowUp"
                      ? -6
                      : +6;
                  const next =
                    (idx + delta + COLOR_TOKENS.length) % COLOR_TOKENS.length;
                  setColorToken(COLOR_TOKENS[next] as ColorToken);
                }}
                title={style.persianName}
                className={`relative flex h-8 items-center justify-center rounded transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-blue-500 ${
                  isSelected
                    ? "ring-2 ring-offset-1 ring-blue-500"
                    : "hover:scale-110"
                }`}
                style={{
                  backgroundColor: style.bg,
                  color:           style.text,
                }}
              >
                {isSelected ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={isSubmitting || trimmedName.length === 0}
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "در حال ذخیره..." : "ذخیره"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          انصراف
        </button>
      </div>
    </form>
  );
}
