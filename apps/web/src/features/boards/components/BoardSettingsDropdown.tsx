"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "../../../utils/trpc";
import { toast } from "sonner";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";

interface Props {
  board: {
    id: string;
    title: string;
    role: string;
    archivedAt: string | null;
  };
  onMutated: () => void;
}

export function BoardSettingsDropdown({ board, onMutated }: Props) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(board.title);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const isAdmin = board.role === "OWNER" || board.role === "ADMIN";
  const isOwner = board.role === "OWNER";
  const isArchived = !!board.archivedAt;

  // Dismissable-layer behaviour (a11y-conventions.md): close on outside click
  // AND Escape; move focus to the first menu item on open and restore it to
  // the trigger on close.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    // Focus the first menu item once the panel is mounted.
    queueMicrotask(() => {
      ref.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus();
    });
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger when the menu closes.
      triggerRef.current?.focus();
    };
  }, [open]);

  const renameMutation = trpc.v1.public.boardManagement.renameBoard.useMutation({
    onSuccess: () => { toast.success("نام بورد تغییر کرد."); setRenaming(false); onMutated(); },
    onError: (e) => toast.error(e.message),
  });

  const archiveMutation = trpc.v1.public.boardManagement.archiveBoard.useMutation({
    onSuccess: () => { toast.success("بورد بایگانی شد."); setOpen(false); onMutated(); },
    onError: (e) => toast.error(e.message),
  });

  const unarchiveMutation = trpc.v1.public.boardManagement.unarchiveBoard.useMutation({
    onSuccess: () => { toast.success("بورد از بایگانی خارج شد."); setOpen(false); onMutated(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.v1.public.boardManagement.softDeleteBoard.useMutation({
    onSuccess: () => { toast.success("بورد حذف شد."); setOpen(false); onMutated(); },
    onError: (e) => toast.error(e.message),
  });

  if (!isAdmin) return null;

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        className="rounded p-1 text-slate-400 hover:bg-slate-600 hover:text-white"
        aria-label="تنظیمات بورد"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
        </svg>
      </button>

      {open && (
        <div role="menu" dir="rtl" className="absolute end-0 top-8 z-50 w-56 rounded-lg border border-slate-600 bg-slate-800 py-1 text-start shadow-xl">
          {/* Rename */}
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newTitle.trim() && newTitle !== board.title) {
                  renameMutation.mutate({ boardId: board.id, title: newTitle.trim() });
                } else {
                  setRenaming(false);
                }
              }}
              className="px-3 py-2"
            >
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                maxLength={128}
                className="w-full rounded border border-slate-600 bg-slate-700 px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
              <div className="mt-1 flex gap-1">
                <button type="submit" className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white">ذخیره</button>
                <button type="button" onClick={() => setRenaming(false)} className="text-xs text-slate-400">انصراف</button>
              </div>
            </form>
          ) : (
            <button
              role="menuitem"
              onClick={() => { setRenaming(true); setNewTitle(board.title); }}
              className="w-full px-3 py-2 text-start text-sm text-slate-300 hover:bg-slate-700"
            >
              تغییر نام
            </button>
          )}

          {/* Archive / Unarchive */}
          {isArchived ? (
            <button
              role="menuitem"
              onClick={() => unarchiveMutation.mutate({ boardId: board.id })}
              className="w-full px-3 py-2 text-start text-sm text-slate-300 hover:bg-slate-700"
            >
              خروج از بایگانی
            </button>
          ) : (
            <button
              role="menuitem"
              onClick={() => archiveMutation.mutate({ boardId: board.id })}
              className="w-full px-3 py-2 text-start text-sm text-slate-300 hover:bg-slate-700"
            >
              بایگانی
            </button>
          )}

          {/* Delete (OWNER only) */}
          {isOwner && (
            <>
              <div className="mx-3 my-1 border-t border-slate-700" />
              <button
                role="menuitem"
                onClick={() => setConfirmDeleteOpen(true)}
                className="w-full px-3 py-2 text-start text-sm text-red-400 hover:bg-red-900/30"
              >
                حذف بورد
              </button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="حذف بورد"
        description={`بورد «${board.title}» حذف می‌شود. این عمل قابل بازگشت نیست.`}
        confirmLabel="حذف"
        cancelLabel="انصراف"
        variant="danger"
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          deleteMutation.mutate({ boardId: board.id });
          setConfirmDeleteOpen(false);
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
