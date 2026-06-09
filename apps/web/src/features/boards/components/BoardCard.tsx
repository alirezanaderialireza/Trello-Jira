"use client";

import Link from "next/link";
import { useState } from "react";
import { BoardSettingsDropdown } from "./BoardSettingsDropdown";

interface BoardCardProps {
  board: {
    id: string;
    title: string;
    role: string;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  onMutated: () => void;
}

export function BoardCard({ board, onMutated }: BoardCardProps) {
  const isArchived = !!board.archivedAt;

  return (
    <div
      className={`group relative rounded-lg border p-4 transition-colors ${
        isArchived
          ? "border-slate-700 bg-slate-800/40 opacity-60"
          : "border-slate-700 bg-slate-800 hover:border-slate-500 hover:bg-slate-700/80"
      }`}
    >
      {/* Settings dropdown (top-right) */}
      <div className="absolute end-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
        <BoardSettingsDropdown board={board} onMutated={onMutated} />
      </div>

      {/* Board link */}
      <Link href={`/board/${board.id}`} className="block">
        <h3 className="truncate pe-8 text-base font-semibold text-white">
          {board.title}
        </h3>

        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium uppercase">
            {board.role}
          </span>
          {isArchived && (
            <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              Archived
            </span>
          )}
        </div>

        <p className="mt-2 text-[11px] text-slate-500">
          Updated {new Date(board.updatedAt).toLocaleDateString()}
        </p>
      </Link>
    </div>
  );
}
