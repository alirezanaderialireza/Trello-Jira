"use client";

import { useState } from "react";
import { trpc } from "../../../utils/trpc";
import { toast } from "sonner";

interface Props {
  onCreated: () => void;
}

export function CreateBoardDialog({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const createMutation = trpc.v1.public.boardManagement.createBoard.useMutation({
    onSuccess: (data) => {
      toast.success(`Board "${data.title}" created!`);
      setOpen(false);
      setTitle("");
      onCreated();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create board.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createMutation.mutate({ title: title.trim() });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
      >
        + New Board
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-2xl"
      >
        <h2 className="text-lg font-semibold text-white">Create New Board</h2>

        <input
          autoFocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="عنوان بورد..."
          maxLength={128}
          className="mt-4 w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => { setOpen(false); setTitle(""); }}
            className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || createMutation.isPending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {createMutation.isPending ? "Creating..." : "Create Board"}
          </button>
        </div>
      </form>
    </div>
  );
}
