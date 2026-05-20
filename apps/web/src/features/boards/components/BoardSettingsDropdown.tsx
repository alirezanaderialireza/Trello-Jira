"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "../../../utils/trpc";
import { toast } from "sonner";

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
  const ref = useRef<HTMLDivElement>(null);

  const isAdmin = board.role === "OWNER" || board.role === "ADMIN";
  const isOwner = board.role === "OWNER";
  const isArchived = !!board.archivedAt;

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const renameMutation = trpc.v1.public.boardManagement.renameBoard.useMutation({
    onSuccess: () => { toast.success("Board renamed."); setRenaming(false); onMutated(); },
    onError: (e) => toast.error(e.message),
  });

  const archiveMutation = trpc.v1.public.boardManagement.archiveBoard.useMutation({
    onSuccess: () => { toast.success("Board archived."); setOpen(false); onMutated(); },
    onError: (e) => toast.error(e.message),
  });

  const unarchiveMutation = trpc.v1.public.boardManagement.unarchiveBoard.useMutation({
    onSuccess: () => { toast.success("Board restored."); setOpen(false); onMutated(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.v1.public.boardManagement.deleteBoard.useMutation({
    onSuccess: () => { toast.success("Board deleted."); setOpen(false); onMutated(); },
    onError: (e) => toast.error(e.message),
  });

  if (!isAdmin) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        className="rounded p-1 text-slate-400 hover:bg-slate-600 hover:text-white"
        aria-label="Board settings"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 w-56 rounded-lg border border-slate-600 bg-slate-800 py-1 shadow-xl">
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
                <button type="submit" className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white">Save</button>
                <button type="button" onClick={() => setRenaming(false)} className="text-xs text-slate-400">Cancel</button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => { setRenaming(true); setNewTitle(board.title); }}
              className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700"
            >
              Rename
            </button>
          )}

          {/* Archive / Unarchive */}
          {isArchived ? (
            <button
              onClick={() => unarchiveMutation.mutate({ boardId: board.id })}
              className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700"
            >
              Restore from archive
            </button>
          ) : (
            <button
              onClick={() => archiveMutation.mutate({ boardId: board.id })}
              className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700"
            >
              Archive
            </button>
          )}

          {/* Delete (OWNER only) */}
          {isOwner && (
            <>
              <div className="mx-3 my-1 border-t border-slate-700" />
              <button
                onClick={() => {
                  if (confirm(`Delete "${board.title}" permanently? This cannot be undone.`)) {
                    deleteMutation.mutate({ boardId: board.id });
                  }
                }}
                className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-900/30"
              >
                Delete board
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
