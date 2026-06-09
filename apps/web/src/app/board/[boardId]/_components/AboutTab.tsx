"use client";

// apps/web/src/app/board/[boardId]/_components/AboutTab.tsx
//
// Board "About" tab — title rename + editable description.
//
// Scope:
//   • Title is editable for OWNER + ADMIN (legacy renameBoard action).
//     Diff-checks against initialTitle; only submits when changed.
//   • Description is editable for OWNER + ADMIN (F1.4.2) via
//     updateBoardMetadata. Independent block with its own textarea + save,
//     so the working title form is left untouched. Empty → clears (NULL).
//   • On success both blocks invalidate getBoardSettings + router.refresh.
//
// Role gating:
//   • OWNER + ADMIN → editable inputs + save buttons.
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
  onUpdateDescription: (input: {
    boardId: string;
    description: string | null;
  }) => Promise<ActionResult>;
}

const TITLE_MAX = 128;
const DESC_MAX = 5000;

export function AboutTab({
  boardId,
  initialTitle,
  description,
  role,
  onRename,
  onUpdateDescription,
}: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(initialTitle);
  const [isSaving, startSave] = useTransition();

  // Description editor state (F1.4.2).
  const [desc, setDesc] = useState(description ?? "");
  const [isSavingDesc, startSaveDesc] = useTransition();

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

  // ── Description editor (F1.4.2) ────────────────────────────────────────────
  const trimmedDesc = desc.trim();
  const descChanged = trimmedDesc !== (description ?? "");
  const descError =
    trimmedDesc.length > DESC_MAX
      ? `توضیحات نباید از ${DESC_MAX} کاراکتر بیشتر باشد.`
      : null;
  const canSubmitDesc = canEdit && descChanged && !descError && !isSavingDesc;

  const handleSubmitDesc = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmitDesc) return;

    startSaveDesc(async () => {
      const result = await onUpdateDescription({
        boardId,
        description: trimmedDesc.length === 0 ? null : trimmedDesc,
      });
      if (result.ok) {
        toast.success("توضیحات بورد به‌روزرسانی شد.");
        await utils.v1.public.boardManagement.getBoardSettings.invalidate({
          boardId,
        });
        router.refresh();
      } else {
        toast.error(result.error ?? "خطا در ذخیرهٔ توضیحات.");
      }
    });
  };

  const handleResetDesc = () => setDesc(description ?? "");

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

      {/* ── Description (editable for OWNER/ADMIN — F1.4.2) ─────────────── */}
      <div>
        {canEdit ? (
          <form onSubmit={handleSubmitDesc}>
            <label
              htmlFor="board-about-description"
              className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-900"
            >
              <Pencil className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              توضیحات
            </label>
            <textarea
              id="board-about-description"
              dir="auto"
              rows={4}
              value={desc}
              onChange={(event) => setDesc(event.target.value)}
              maxLength={DESC_MAX}
              disabled={isSavingDesc}
              placeholder="توضیحاتی دربارهٔ این بورد بنویسید..."
              className={`block w-full resize-y rounded-lg border px-3 py-2 text-sm leading-7 text-slate-900 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-100 ${
                descError
                  ? "border-red-300 focus:border-red-500 focus:ring-red-200"
                  : "border-slate-300 focus:border-blue-500 focus:ring-blue-200"
              }`}
            />
            <div className="mt-1 flex items-center justify-between">
              <span className={`text-[11px] ${descError ? "text-red-600" : "text-slate-400"}`}>
                {trimmedDesc.length.toLocaleString("fa-IR")} / ۵٬۰۰۰
              </span>
              {descError && <span className="text-xs text-red-600">{descError}</span>}
            </div>

            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleResetDesc}
                disabled={!descChanged || isSavingDesc}
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                بازنشانی
              </button>
              <button
                type="submit"
                disabled={!canSubmitDesc}
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingDesc ? "در حال ذخیره..." : "ذخیره"}
              </button>
            </div>
          </form>
        ) : (
          <>
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
          </>
        )}
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-500">
          فقط مدیران و مالک بورد می‌توانند مشخصات بورد را تغییر دهند.
        </div>
      )}
    </div>
  );
}
