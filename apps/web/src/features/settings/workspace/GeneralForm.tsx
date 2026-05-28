"use client";

// apps/web/src/features/settings/workspace/GeneralForm.tsx
//
// Client form for the General settings tab. Bound to the
// `updateWorkspaceAction` Server Action (passed in as a prop —
// boundaries linter forbids feature → app imports, see Lesson F4).
//
// Submit semantics:
//   • Diff against initial values; only changed fields are sent to
//     the server. Avoids a no-op update returning a "no changes"
//     server error.
//   • Visibility is OWNER-gated. ADMIN viewers see the radios in a
//     disabled state with a small Persian note.
//   • On success with a slug change, navigate to the NEW slug-based
//     URL so the user's address bar reflects reality.
//   • On success without a slug change, router.refresh() so the
//     layout's getBySlug re-fetches and any header text updates.
//   • All errors surface via toast.error with the server's Persian
//     message verbatim.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export type Visibility = "private" | "public";

export type UpdateWorkspaceAction = (input: {
  workspaceId: string;
  name?: string;
  description?: string | null;
  slug?: string;
  visibility?: Visibility;
}) => Promise<{ ok: boolean; slug?: string; error?: string }>;

interface Props {
  workspaceId: string;
  initialName: string;
  initialDescription: string | null;
  initialSlug: string;
  initialVisibility: Visibility;
  /** True when the current viewer is OWNER. ADMIN cannot change visibility. */
  canChangeVisibility: boolean;
  onSubmit: UpdateWorkspaceAction;
}

const NAME_MAX = 100;
const DESCRIPTION_MAX = 1000;
const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function GeneralForm({
  workspaceId,
  initialName,
  initialDescription,
  initialSlug,
  initialVisibility,
  canChangeVisibility,
  onSubmit,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [slug, setSlug] = useState(initialSlug);
  const [visibility, setVisibility] = useState<Visibility>(initialVisibility);
  const [isSaving, startSave] = useTransition();

  const trimmedDescription = description.trim();
  const initialDescriptionTrimmed = (initialDescription ?? "").trim();

  const hasChanges =
    name.trim() !== initialName ||
    trimmedDescription !== initialDescriptionTrimmed ||
    slug.trim() !== initialSlug ||
    visibility !== initialVisibility;

  // Local validation (Persian messages). The Server Action and the
  // tRPC procedure run their own validations server-side — these
  // are just for snappy form feedback.
  const slugError =
    slug.trim().length > 0 && !SLUG_PATTERN.test(slug.trim())
      ? "نامک فقط می‌تواند حروف کوچک انگلیسی، عدد و خط تیره داشته باشد."
      : null;
  const nameError =
    name.trim().length === 0
      ? "نام فضای کاری الزامی است."
      : name.trim().length > NAME_MAX
        ? `نام نباید از ${NAME_MAX} کاراکتر بیشتر باشد.`
        : null;
  const descriptionError =
    trimmedDescription.length > DESCRIPTION_MAX
      ? `توضیحات نباید از ${DESCRIPTION_MAX} کاراکتر بیشتر باشد.`
      : null;

  const hasError = Boolean(nameError || slugError || descriptionError);
  const canSubmit = hasChanges && !hasError && !isSaving;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    startSave(async () => {
      // Build a minimal input — only fields that actually changed.
      const input: Parameters<UpdateWorkspaceAction>[0] = { workspaceId };
      if (name.trim() !== initialName) input.name = name.trim();
      if (trimmedDescription !== initialDescriptionTrimmed) {
        // null serialises as "explicit clear"; empty string maps to null.
        input.description = trimmedDescription.length === 0 ? null : trimmedDescription;
      }
      if (slug.trim() !== initialSlug) input.slug = slug.trim();
      if (visibility !== initialVisibility) input.visibility = visibility;

      const result = await onSubmit(input);
      if (result.ok) {
        toast.success("تغییرات ذخیره شد.");
        if (result.slug && result.slug !== initialSlug) {
          // Slug changed — navigate to the new URL so the user's
          // bookmark/share link stays consistent.
          router.push(`/workspaces/${result.slug}/settings/general`);
        } else {
          // Same slug — just refresh the Server Components so the
          // header re-renders with the updated workspace name.
          router.refresh();
        }
      } else {
        toast.error(result.error ?? "خطا در ذخیره تغییرات.");
      }
    });
  };

  const handleReset = () => {
    setName(initialName);
    setDescription(initialDescription ?? "");
    setSlug(initialSlug);
    setVisibility(initialVisibility);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Name */}
      <div>
        <label
          htmlFor="ws-settings-name"
          className="mb-1.5 block text-sm font-medium text-slate-900"
        >
          نام فضای کاری
        </label>
        <input
          id="ws-settings-name"
          type="text"
          dir="auto"
          maxLength={NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={isSaving}
          className={`block w-full rounded-lg border px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-100 ${
            nameError
              ? "border-red-300 focus:border-red-500 focus:ring-red-200"
              : "border-slate-300 focus:border-blue-500 focus:ring-blue-200"
          }`}
        />
        {nameError && (
          <p className="mt-1 text-xs text-red-600">{nameError}</p>
        )}
      </div>

      {/* Description */}
      <div>
        <label
          htmlFor="ws-settings-description"
          className="mb-1.5 block text-sm font-medium text-slate-900"
        >
          توضیحات
          <span className="ms-1 text-xs font-normal text-slate-400">(اختیاری)</span>
        </label>
        <textarea
          id="ws-settings-description"
          dir="auto"
          rows={4}
          maxLength={DESCRIPTION_MAX}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isSaving}
          className={`block w-full resize-y rounded-lg border px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-100 ${
            descriptionError
              ? "border-red-300 focus:border-red-500 focus:ring-red-200"
              : "border-slate-300 focus:border-blue-500 focus:ring-blue-200"
          }`}
        />
        <div className="mt-1 flex items-center justify-between">
          {descriptionError ? (
            <p className="text-xs text-red-600">{descriptionError}</p>
          ) : (
            <p className="text-xs text-slate-400">برای اعضای فضای کاری نمایش داده می‌شود.</p>
          )}
          <p className="text-xs text-slate-400">
            {trimmedDescription.length.toLocaleString("fa-IR")}/
            {DESCRIPTION_MAX.toLocaleString("fa-IR")}
          </p>
        </div>
      </div>

      {/* Slug */}
      <div>
        <label
          htmlFor="ws-settings-slug"
          className="mb-1.5 block text-sm font-medium text-slate-900"
        >
          نامک URL
        </label>
        <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200">
          <span className="flex shrink-0 items-center bg-slate-100 px-3 text-xs text-slate-500">
            <span dir="ltr">/workspaces/</span>
          </span>
          <input
            id="ws-settings-slug"
            type="text"
            dir="ltr"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            required
            disabled={isSaving}
            className="block w-full px-3 py-2 text-sm text-slate-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </div>
        {slugError ? (
          <p className="mt-1 text-xs text-red-600">{slugError}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-400">
            تغییر نامک، آدرس فضای کاری را تغییر می‌دهد. لینک‌های قدیمی کار نخواهند کرد.
          </p>
        )}
      </div>

      {/* Visibility */}
      <div>
        <fieldset disabled={!canChangeVisibility || isSaving}>
          <legend className="mb-1.5 block text-sm font-medium text-slate-900">
            دیده‌شدن
          </legend>
          <div className="space-y-2">
            <VisibilityRadio
              value="private"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
              title="خصوصی"
              description="فقط اعضای فضای کاری می‌توانند بوردها را ببینند."
              disabled={!canChangeVisibility}
            />
            <VisibilityRadio
              value="public"
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
              title="عمومی"
              description="هر کسی با لینک می‌تواند بوردهای عمومی را ببیند."
              disabled={!canChangeVisibility}
            />
          </div>
        </fieldset>
        {!canChangeVisibility && (
          <p className="mt-2 text-xs text-slate-500">
            تغییر دیده‌شدن فضای کاری فقط توسط مالک امکان‌پذیر است.
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          onClick={handleReset}
          disabled={!hasChanges || isSaving}
          className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          بازنشانی
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "در حال ذخیره..." : "ذخیره تغییرات"}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function VisibilityRadio({
  value,
  checked,
  onChange,
  title,
  description,
  disabled,
}: {
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
  disabled: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
        checked
          ? "border-blue-300 bg-blue-50"
          : "border-slate-200 bg-white hover:bg-slate-50"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type="radio"
        name="ws-settings-visibility"
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-1"
      />
      <div className="flex-1">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
    </label>
  );
}
