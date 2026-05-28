"use client";

// apps/web/src/app/board/[boardId]/_components/AboutTab.tsx
//
// Board "About" tab — title rename + read-only description display.
//
// F5b scope:
//   • Title is editable for OWNER + ADMIN. The form diff-checks
//     against initialTitle and only submits when the value changed.
//     On success, calls utils.invalidate() so the drawer's
//     getBoardSettings query (and therefore the title in the
//     drawer header) re-fetches.
//   • Description is read-only. The renameBoard procedure does
//     NOT yet accept a description input (steering TODO: extend
//     renameBoard or add a dedicated procedure in F1.2). Showing
//     it here keeps the user oriented even though the editor is
//     deferred.
//
// Role gating:
//   • OWNER + ADMIN → editable input + save button.
//   • MEMBER        → read-only display with a Persian explainer.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";

import { trpc } from "../../../../utils/trpc";
import type { ActionResult } from "../_actions/_helpers";

interface Props {
  boardId: string;
  initialTitle: string;
  description: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  onRename: (input: { boardId: string; title: string }) => Promise<ActionResult>;
}

const TITLE_MAX = 128;

export function AboutTab({
  boardId,
  initialTitle,
  description,
  role,
  onRename,
}: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(initialTitle);
  const [isSaving, startSave] = useTransition();

  const canEdit = role === "OWNER" || role === "ADMIN";

  const trimmed = title.trim();
  const hasChanges = trimmed !== initialTitle;
  const titleError =
    trimmed.length === 0
      ? "عنوان بورد الزامی است."
      : trimmed.length > TITLE_MAX
        ? `عنوان بورد نباید از ${TITLE_MAX} کاراکتر بیشتر باشد.`
        : null;

  const canSubmit = canEdit && hasChanges && !titleError && !isSaving;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    startSave(async () => {
      const result = await onRename({ boardId, title: trimmed });
      if (result.ok) {
        toast.success("عنوان بورد به‌روزرسانی شد.");
        // Refresh the drawer's metadata query so the new title is
        // reflected on next open / next render.
        await utils.v1.public.boardManagement.getBoardSettings.invalidate({
          boardId,
        });
        router.refresh();
      } else {
        toast.error(result.error ?? "خطا در تغییر عنوان.");
      }
    });
  };

  const handleReset = () => setTitle(initialTitle);

  return (
    <div className="space-y-6">
      {/* ── Title ───────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit}>
        <label
          htmlFor="board-about-title"
          className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-900"
        >
          <Pencil className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          عنوان بورد
        </label>
        <input
          id="board-about-title"
          type="text"
          dir="auto"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={TITLE_MAX}
          required
          disabled={!canEdit || isSaving}
          className={`block w-full rounded-lg border px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-100 ${
            titleError
              ? "border-red-300 focus:border-red-500 focus:ring-red-200"
              : "border-slate-300 focus:border-blue-500 focus:ring-blue-200"
          }`}
        />
        {titleError && (
          <p className="mt-1 text-xs text-red-600">{titleError}</p>
        )}

        {canEdit && (
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={handleReset}
              disabled={!hasChanges || isSaving}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              بازنشانی
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "در حال ذخیره..." : "ذخیره"}
            </button>
          </div>
        )}
      </form>

      {/* ── Description (read-only — see header note) ───────────────────── */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-900">توضیحات</p>
        {description ? (
          <p
            dir="auto"
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-7 text-slate-700"
          >
            {description}
          </p>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-400">
            توضیحاتی برای این بورد ثبت نشده.
          </p>
        )}
        <p className="mt-1 text-[11px] text-slate-400">
          ویرایش توضیحات در نسخهٔ بعدی اضافه خواهد شد.
        </p>
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-500">
          فقط مدیران و مالک بورد می‌توانند مشخصات بورد را تغییر دهند.
        </div>
      )}
    </div>
  );
}
