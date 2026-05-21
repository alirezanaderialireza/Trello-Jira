"use client";

import { useState } from "react";
import { trpc } from "../../../utils/trpc";
import { BoardCard } from "./BoardCard";
import { CreateBoardDialog } from "./CreateBoardDialog";

export function BoardListPage() {
  const [showArchived, setShowArchived] = useState(false);

  const { data, isLoading, error, refetch } =
    trpc.v1.public.boardManagement.getBoardsByUser.useQuery(
      { limit: 50, includeArchived: showArchived },
    );

  const boards = data?.boards ?? [];

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-800/60 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <h1 className="text-xl font-bold">My Boards</h1>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-slate-600 bg-slate-700"
              />
              Show archived
            </label>
            <CreateBoardDialog onCreated={refetch} />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-900/30 p-4 text-red-300">
            Failed to load boards. {error.message}
          </div>
        )}

        {!isLoading && boards.length === 0 && (
          <div className="py-20 text-center text-slate-500">
            <p className="text-lg">No boards yet.</p>
            <p className="mt-1 text-sm">Create your first board to get started.</p>
          </div>
        )}

        {boards.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {boards.map((board) => (
              <BoardCard key={board.id} board={board} onMutated={refetch} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
