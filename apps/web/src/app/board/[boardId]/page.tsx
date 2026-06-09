// apps/web/src/app/board/[boardId]/page.tsx

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { Archive } from "lucide-react";

import { appRouter, createContext } from "@repo/api";
import { getWebSession } from "@/auth/getServerSession";
import { getBoardData } from "../../../features/board/actions/board.actions";
import BoardView from "../../../features/board/components/BoardView";
import type { FullBoardDto } from "../../../features/board/components/BoardView";

import {
  DEFAULT_BACKGROUND_CSS,
  renderBackgroundCss,
} from "../../../features/board-settings/lib/applyBackground";

import { BoardBackgroundController } from "./_components/BoardBackgroundController";
import { BoardSettings } from "./_components/BoardSettings";

import { archiveBoardAction } from "./_actions/archiveBoard";
import { changeBoardMemberRoleAction } from "./_actions/changeBoardMemberRole";
import { softDeleteBoardAction } from "./_actions/softDeleteBoard";
import { inviteBoardMemberAction } from "./_actions/inviteBoardMember";
import { removeBoardMemberAction } from "./_actions/removeBoardMember";
import { renameBoardAction } from "./_actions/renameBoard";
import { updateBoardDescriptionAction } from "./_actions/updateBoardDescription";
import { restoreBoardAction } from "./_actions/restoreBoard";
import { setBackgroundAction } from "./_actions/setBackground";
import { unarchiveBoardAction } from "./_actions/unarchiveBoard";
import { updateBoardVisibilityAction } from "./_actions/updateVisibility";

interface BoardPageProps {
  params: Promise<{ boardId: string }>;
}

// ─── Server Actions bag wired into <BoardSettings>. Defined at module ─
// level so it's stable across renders (Next.js Server Actions are
// reference-stable references; the bag is just a literal pointing at
// them and is safe to share across pages).

const BOARD_SETTINGS_ACTIONS = {
  onRename: renameBoardAction,
  onUpdateDescription: updateBoardDescriptionAction,
  onArchive: archiveBoardAction,
  onUnarchive: unarchiveBoardAction,
  onDelete: softDeleteBoardAction,
  onRestore: restoreBoardAction,
  onSetBackground: setBackgroundAction,
  onUpdateVisibility: updateBoardVisibilityAction,
  onInviteMember: inviteBoardMemberAction,
  onChangeRole: changeBoardMemberRoleAction,
  onRemoveMember: removeBoardMemberAction,
} as const;

export default async function BoardPage({ params }: BoardPageProps) {
  const { boardId } = await params;

  try {
    // ── Parallel fetch: board projection + settings metadata ───────────
    //
    // getBoardData is the heavy projection used by BoardView.
    // getBoardSettings is the small settings-tab hydration source
    // — backgroundData (for first-paint colour), title, role,
    // visibility, archivedAt. Caching is shared across both via
    // React's request memoization but we still need two distinct
    // procedure calls because the projection doesn't surface the
    // settings fields.
    const session = await getWebSession();
    const settingsCaller = session
      ? appRouter.createCaller(await createContext({ session: session as any }))
      : null;

    const [raw, boardSettings] = await Promise.all([
      getBoardData({ id: boardId }),
      settingsCaller
        ? settingsCaller.v1.public.boardManagement
            .getBoardSettings({ boardId })
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    if (!raw) {
      return (
        <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-white">
          <div className="bg-zinc-900 border border-red-500/30 rounded-2xl p-8 max-w-lg w-full shadow-2xl">
            <h1 className="text-2xl font-bold text-red-400 mb-4">Board Not Found</h1>
            <div className="space-y-2 text-sm text-zinc-300">
              <p>The requested board does not exist or failed to load.</p>
              <div className="bg-black/40 rounded-lg p-3 border border-zinc-800 mt-4">
                <p className="text-zinc-400">boardId:</p>
                <code className="text-green-400 break-all">{boardId}</code>
              </div>
            </div>
          </div>
        </main>
      );
    }

    const boardData: FullBoardDto = {
      id: raw.id,
      title: raw.title,
      lists: (raw.lists as unknown) as FullBoardDto["lists"],
    };

    // ── Compute the persisted background CSS ─────────────────────────
    // The same value seeds the <main> var() fallback (so SSR paint is
    // correct) AND the BoardBackgroundController (so the drawer's
    // preview path has a baseline to revert to).
    const initialBgCss = boardSettings
      ? renderBackgroundCss(boardSettings.backgroundData)
      : DEFAULT_BACKGROUND_CSS;

    const isArchived = boardSettings?.archivedAt != null;
    // Hide the trigger only for boards we couldn't load settings for
    // (likely RLS / not-a-member edge case). The drawer's per-tab
    // gates handle MEMBER role internally.
    const settingsHidden = boardSettings === null;

    return (
      <BoardBackgroundController initialCss={initialBgCss}>
        <main
          className="min-h-screen font-sans flex flex-col h-screen overflow-hidden text-white"
          style={{ background: `var(--board-bg, ${initialBgCss})` }}
        >
          <header className="p-4 flex items-center justify-between gap-3 shrink-0 border-b border-white/10">
            <h1
              dir="auto"
              className="truncate text-white text-xl font-bold tracking-tight"
              title={boardData.title}
            >
              {boardData.title}
            </h1>
            <BoardSettings
              boardId={boardId}
              actions={BOARD_SETTINGS_ACTIONS}
              hidden={settingsHidden}
            />
          </header>

          {isArchived && (
            <div className="shrink-0 border-b border-amber-300/30 bg-amber-500/15 px-4 py-2 text-xs text-amber-50">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                  این بورد بایگانی شده — از تنظیمات می‌توانید آن را بازگردانی کنید.
                </span>
                <Link
                  href={`/board/${boardId}?settings=danger`}
                  className="rounded-md bg-amber-100 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-50"
                  prefetch={false}
                >
                  باز کردن تنظیمات
                </Link>
              </div>
            </div>
          )}

          <Suspense
            fallback={<div className="p-4 text-white font-medium">Loading Board View...</div>}
          >
            <div className="flex-1 min-h-0">
              <BoardView data={boardData} boardId={boardId} />
            </div>
          </Suspense>
        </main>
      </BoardBackgroundController>
    );
  } catch (error) {
    console.error("[BoardPage] Fatal board load error:", error);

    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white p-6">
        <div className="w-full max-w-2xl rounded-2xl border border-red-500/30 bg-zinc-950 p-6 shadow-2xl">
          <h1 className="text-2xl font-bold text-red-400 mb-4">Failed To Load Board</h1>
          <div className="space-y-4">
            <div>
              <p className="text-zinc-400 text-sm mb-1">Board ID</p>
              <code className="block bg-zinc-900 p-3 rounded-lg text-green-400 break-all border border-zinc-800">
                {boardId}
              </code>
            </div>
            {process.env.NODE_ENV === "development" && (
              <div>
                <p className="text-zinc-400 text-sm mb-1">Error</p>
                <pre className="bg-zinc-900 p-4 rounded-lg text-red-300 text-xs overflow-auto border border-zinc-800 whitespace-pre-wrap">
                  {error instanceof Error ? error.stack : JSON.stringify(error, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }
}
