"use client";

// apps/web/src/features/shell/sidebar/CreateWorkspaceButton.tsx
//
// "+ فضای کاری جدید" CTA at the bottom of the Workspaces section.
//
// Opens an inline dialog (no Radix dep — see F4 D4) with a single
// name input and a submit button. The form's submit handler invokes
// a Server Action (createWorkspaceAction under app/(app)/_actions/)
// that is injected as a prop by the parent app layout. This keeps
// the boundaries linter happy: features must never import from
// app/* (one-way rule: app → features OK, features → app NOT OK).
// Server Action results carry a discriminated `{ ok, error?, slug? }`
// object so we can surface validation errors as Persian toasts
// without throwing.
//
// Closing strategies covered:
//   • Click backdrop
//   • Press Escape
//   • Click X button
//   • Submit succeeds → navigate to /workspaces/{slug}

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "../../../utils/trpc";

/**
 * Shape of the Server Action result. Defined structurally here so the
 * feature never imports from app/* (forbidden by boundaries linter).
 * The action under app/(app)/_actions/createWorkspace.ts conforms to
 * this shape; TypeScript verifies assignability at the parent (app)
 * layer where the action is wired in.
 */
export type CreateWorkspaceAction = (
  formData: FormData,
) => Promise<{ ok: boolean; slug?: string; error?: string }>;

interface CreateWorkspaceButtonProps {
  onCreateWorkspace: CreateWorkspaceAction;
}

export function CreateWorkspaceButton({
  onCreateWorkspace,
}: CreateWorkspaceButtonProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus the input when the dialog opens.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("نام فضای کاری الزامی است.");
      return;
    }
    if (trimmed.length > 100) {
      toast.error("نام فضای کاری نباید از ۱۰۰ کاراکتر بیشتر باشد.");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("name", trimmed);
      const result = await onCreateWorkspace(formData);

      if (!result.ok) {
        toast.error(result.error ?? "خطا در ساخت فضای کاری.");
        return;
      }

      toast.success("فضای کاری ساخته شد.");
      setOpen(false);
      setName("");

      // Refresh the sidebar bootstrap so the new workspace appears
      // without a full reload, then navigate the user into it.
      utils.v1.public.sidebar.bootstrap.invalidate();
      if (result.slug) {
        router.push(`/workspaces/${result.slug}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="
          mt-2 flex w-full items-center gap-2 rounded-md
          px-2 py-1.5 text-sm text-slate-600
          hover:bg-slate-100 hover:text-slate-900
          focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-blue-500
        "
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span>فضای کاری جدید</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-workspace-title"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Dialog */}
          <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2
                id="create-workspace-title"
                className="text-lg font-semibold text-slate-900"
              >
                فضای کاری جدید
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="بستن"
                className="
                  rounded-md p-1 text-slate-400 hover:bg-slate-100
                  hover:text-slate-700 focus-visible:outline-none
                  focus-visible:ring-2 focus-visible:ring-blue-500
                "
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <label
                htmlFor="workspace-name"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                نام
              </label>
              <input
                ref={inputRef}
                id="workspace-name"
                name="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder="مثلاً: تیم محصول"
                dir="auto"
                className="
                  w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                  focus:border-blue-500 focus:outline-none focus:ring-1
                  focus:ring-blue-500
                "
              />
              <p className="mt-2 text-xs text-slate-500">
                می‌توانید بعداً نام و آدرس (slug) را تغییر دهید.
              </p>

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="
                    rounded-md px-4 py-2 text-sm font-medium text-slate-700
                    hover:bg-slate-100 focus-visible:outline-none
                    focus-visible:ring-2 focus-visible:ring-slate-300
                  "
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={submitting || !name.trim()}
                  className="
                    rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white
                    hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50
                    focus-visible:outline-none focus-visible:ring-2
                    focus-visible:ring-blue-600 focus-visible:ring-offset-2
                  "
                >
                  {submitting ? "در حال ساخت…" : "ساخت"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
