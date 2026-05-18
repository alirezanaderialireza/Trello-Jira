// apps/web/src/app/board/[boardId]/page.tsx
//
// Fixes applied:
// ✅ #16: Pass `boardSequence` from the SSR fetch result through to BoardView
//         so the Zustand reconciler is aligned from the very first render.
//         Previously the cast `(raw.lists as unknown) as FullBoardDto["lists"]`
//         discarded `boardSequence` and BoardView hardcoded sequence "0",
//         causing every WebSocket event to look like a gap.

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { getBoardData } from "../../../features/board/actions/board.actions";
import BoardView, { type FullBoardDto } from "../../../features/board/components/BoardView";

interface BoardPageProps {
  params: Promise<{ boardId: string }>;
}

export default async function BoardPage({ params }: BoardPageProps) {
  const { boardId } = await params;

  try {
    const raw = await getBoardData({ id: boardId });

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

    // ✅ #16: boardSequence from SSR is forwarded into FullBoardDto so BoardView
    //         passes the real sequence to initBoard — not the hardcoded "0".
    const boardData: FullBoardDto = {
      id:             raw.id,
      title:          raw.title,
      lists:          raw.lists as unknown as FullBoardDto["lists"],
      boardSequence:  raw.boardSequence ?? 0,   // ✅ real sequence
    };

    return (
      <main className="min-h-screen bg-blue-600 font-sans flex flex-col h-screen overflow-hidden">
        <header className="p-4 flex items-center justify-between shrink-0 border-b border-white/10">
          <h1 className="text-white text-xl font-bold tracking-tight">
            {boardData.title}
          </h1>
        </header>

        <Suspense
          fallback={
            <div className="p-4 text-white font-medium">Loading Board View…</div>
          }
        >
          <div className="flex-1 min-h-0">
            <BoardView data={boardData} boardId={boardId} />
          </div>
        </Suspense>
      </main>
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
                  {error instanceof Error
                    ? error.stack
                    : JSON.stringify(error, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }
}
