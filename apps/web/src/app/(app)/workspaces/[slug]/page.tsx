"use client";

// apps/web/src/app/workspaces/[slug]/page.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// Workspace detail page
//
// Renders the boards the current user can see inside a workspace, plus a
// minimal "create board" affordance for members. The boards list comes from
// `workspace.listBoards`, which already enforces:
//   • caller must be a member of the workspace
//   • caller must additionally be a member of each board (board-level ACL)
//   • soft-deleted and (by default) archived boards are filtered out
//
// The create-board mutation reuses the existing `boardManagement.createBoard`
// router. That endpoint pulls `tenantId` from the session, so we don't pass
// the workspaceId explicitly today — note this in the handler below so the
// follow-up to make tenantId an explicit input is easy to spot.
// ─────────────────────────────────────────────────────────────────────────────

import { trpc } from "../../../../utils/trpc";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

export default function WorkspaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug as string;

  // 1. Resolve the workspace by slug — also tells us caller's role.
  const {
    data: workspace,
    isLoading: wsLoading,
    error: wsError,
  } = trpc.v1.public.workspace.getBySlug.useQuery(
    { slug },
    { enabled: Boolean(slug) },
  );

  // 2. Once we know the workspace ID, fetch the boards visible to caller.
  const {
    data: boards,
    isLoading: boardsLoading,
    refetch: refetchBoards,
  } = trpc.v1.public.workspace.listBoards.useQuery(
    { workspaceId: workspace?.id ?? "", includeArchived: false },
    { enabled: Boolean(workspace?.id) },
  );

  // 3. Local state for the create-board form.
  const [newBoardTitle, setNewBoardTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const createBoard = trpc.v1.public.boardManagement.createBoard.useMutation({
    onSuccess: (created) => {
      setNewBoardTitle("");
      setCreating(false);
      toast.success("بورد ساخته شد");
      // Optimistically refresh the list, then navigate into the new board.
      refetchBoards();
      router.push(`/board/${created.id}`);
    },
    onError: (e: any) => {
      setCreating(false);
      toast.error(e.message ?? "ساخت بورد ناموفق بود");
    },
  });

  // ── Loading / error gates ──────────────────────────────────────────────
  if (wsLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">
        Loading workspace...
      </div>
    );
  }
  if (wsError || !workspace) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-red-400">
        Workspace not found
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const canCreateBoard = ["OWNER", "ADMIN", "MEMBER"].includes(
    String(workspace.role),
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{workspace.name}</h1>
            <p className="text-sm text-slate-500">
              /{workspace.slug} • {workspace.role}
            </p>
          </div>
          <Link
            href="/workspaces"
            className="text-sm text-slate-400 hover:text-white"
          >
            ← All Workspaces
          </Link>
        </div>

        {/* Boards list */}
        <section className="rounded-lg border border-slate-700 bg-slate-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Boards</h2>
            {boardsLoading && (
              <span className="text-xs text-slate-500">Loading...</span>
            )}
          </div>

          {!boardsLoading && (boards?.length ?? 0) === 0 && (
            <p className="text-sm text-slate-400">
              No boards yet — create your first one below.
            </p>
          )}

          {(boards?.length ?? 0) > 0 && (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {boards!.map((b: any) => (
                <li key={b.id}>
                  <Link
                    href={`/board/${b.id}`}
                    className="block rounded-md border border-slate-700 bg-slate-900 px-4 py-3 hover:border-slate-500 transition-colors"
                  >
                    <p className="font-medium text-white truncate">{b.title}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                      {b.role}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Create board */}
        {canCreateBoard && (
          <section className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">
              ساخت بورد جدید
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const title = newBoardTitle.trim();
                if (!title || creating) return;
                setCreating(true);
                // NOTE: the underlying createBoard mutation reads tenantId from
                // the session, not from input. That works today because the
                // Auth.js session falls back to the user's personal workspace
                // when no `tenantId` hint is supplied — but it will need to be
                // updated to take an explicit `workspaceId` when users belong
                // to multiple non-personal workspaces. Tracked as a follow-up.
                createBoard.mutate({ title });
              }}
              className="flex gap-2"
            >
              <input
                value={newBoardTitle}
                onChange={(e) => setNewBoardTitle(e.target.value)}
                placeholder="Board title..."
                className="flex-1 rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newBoardTitle.trim() || creating}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
