"use client";

// apps/web/src/app/board/[boardId]/_components/PermissionsTab.tsx
//
// Board visibility radio. Three options matching the F1 schema:
//
//   • workspace — visible to every workspace member
//   • private   — only board members
//   • public    — anyone with the link (with a warning subtext)
//
// Auto-commits on radio change rather than requiring a separate
// "save" button — visibility is a single field, the no-op
// short-circuit is server-side, and the optimistic feel matches
// what users expect from settings panels with a single switch.
//
// Role gating:
//   • OWNER + ADMIN → editable.
//   • MEMBER        → radios disabled with a Persian explainer.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Building2, Globe2, Lock } from "lucide-react";

import { trpc } from "../../../../utils/trpc";
import type { ActionResult } from "../_actions/_helpers";

export type BoardVisibility = "workspace" | "private" | "public";

interface Props {
  boardId: string;
  visibility: BoardVisibility;
  role: "OWNER" | "ADMIN" | "MEMBER";
  onUpdateVisibility: (input: {
    boardId: string;
    visibility: BoardVisibility;
  }) => Promise<ActionResult>;
}

interface OptionDef {
  value: BoardVisibility;
  title: string;
  description: string;
  icon: React.ReactNode;
  /** Optional warning rendered below the description. */
  warning?: string;
}

const OPTIONS: readonly OptionDef[] = [
  {
    value: "workspace",
    title: "اعضای فضای کاری",
    description: "همهٔ اعضای فضای کاری می‌توانند این بورد را ببینند.",
    icon: <Building2 className="h-4 w-4" aria-hidden="true" />,
  },
  {
    value: "private",
    title: "فقط اعضای بورد",
    description: "فقط افرادی که به‌صراحت به این بورد دعوت شده‌اند.",
    icon: <Lock className="h-4 w-4" aria-hidden="true" />,
  },
  {
    value: "public",
    title: "هر کس با لینک",
    description: "هر کسی که آدرس بورد را داشته باشد می‌تواند آن را ببیند.",
    icon: <Globe2 className="h-4 w-4" aria-hidden="true" />,
    warning:
      "بوردهای عمومی می‌توانند توسط موتورهای جست‌وجو ایندکس شوند. اطلاعات حساس را در آن‌ها قرار ندهید.",
  },
] as const;

export function PermissionsTab({
  boardId,
  visibility: initialVisibility,
  role,
  onUpdateVisibility,
}: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  // Optimistic local state — flipped immediately on radio change so
  // the UI feels instant; reverted to the previous value on server
  // failure.
  const [optimistic, setOptimistic] = useState<BoardVisibility>(initialVisibility);
  const [isPending, startTransition] = useTransition();

  const canEdit = role === "OWNER" || role === "ADMIN";

  const handleChange = (next: BoardVisibility) => {
    if (!canEdit || next === optimistic || isPending) return;

    const previous = optimistic;
    setOptimistic(next);

    startTransition(async () => {
      const result = await onUpdateVisibility({ boardId, visibility: next });
      if (result.ok) {
        toast.success("دیده‌شدن بورد به‌روزرسانی شد.");
        await utils.v1.public.boardManagement.getBoardSettings.invalidate({
          boardId,
        });
        router.refresh();
      } else {
        // Revert optimistic flip.
        setOptimistic(previous);
        toast.error(result.error ?? "خطا در تغییر دیده‌شدن.");
      }
    });
  };

  return (
    <div className="space-y-3">
      <fieldset disabled={!canEdit || isPending}>
        <legend className="mb-1.5 block text-sm font-medium text-slate-900">
          دیده‌شدن بورد
        </legend>
        <div className="space-y-2">
          {OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                optimistic === option.value
                  ? "border-blue-300 bg-blue-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              } ${!canEdit ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="board-visibility"
                value={option.value}
                checked={optimistic === option.value}
                onChange={() => handleChange(option.value)}
                disabled={!canEdit}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                  {option.icon}
                  {option.title}
                </div>
                <p className="mt-0.5 text-xs leading-6 text-slate-500">
                  {option.description}
                </p>
                {option.warning && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-[11px] leading-5 text-amber-800">
                    <AlertTriangle
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600"
                      aria-hidden="true"
                    />
                    <span>{option.warning}</span>
                  </div>
                )}
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      {!canEdit && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-500">
          فقط مدیران و مالک بورد می‌توانند دیده‌شدن بورد را تغییر دهند.
        </p>
      )}
    </div>
  );
}
