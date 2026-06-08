"use client";

// apps/web/src/features/board/components/card-detail/CardWatchButton.tsx
//
// Phase 1.2 (F1.2.9) — toggle watching a card. A watcher receives
// notifications for activity on the card (comments, assignment, due date,
// checklist completion). Creating a card or commenting on it auto-watches,
// so this button mostly serves to opt OUT or opt back IN.

import { Eye, EyeOff } from "lucide-react";

import { trpc } from "../../../../utils/trpc";

interface CardWatchButtonProps {
  cardId: string;
  boardId: string;
}

export function CardWatchButton({ cardId, boardId }: CardWatchButtonProps) {
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.v1.public.notification.isWatching.useQuery(
    { boardId, cardId },
    { staleTime: 30_000 },
  );

  const watching = data?.watching ?? false;

  const onSettled = () => {
    void utils.v1.public.notification.isWatching.invalidate({ boardId, cardId });
  };

  const watchMut = trpc.v1.public.notification.watchCard.useMutation({ onSettled });
  const unwatchMut = trpc.v1.public.notification.unwatchCard.useMutation({ onSettled });

  const pending = watchMut.isPending || unwatchMut.isPending || isLoading;

  const toggle = () => {
    if (pending) return;
    if (watching) {
      unwatchMut.mutate({ boardId, cardId });
    } else {
      watchMut.mutate({ boardId, cardId });
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={watching}
      title={watching ? "در حال مشاهده — برای لغو کلیک کنید" : "مشاهده کارت"}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        watching
          ? "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
          : "bg-slate-700 text-slate-300 hover:bg-slate-600"
      }`}
    >
      {watching ? (
        <>
          <Eye className="h-4 w-4" aria-hidden="true" />
          در حال مشاهده
        </>
      ) : (
        <>
          <EyeOff className="h-4 w-4" aria-hidden="true" />
          مشاهده کارت
        </>
      )}
    </button>
  );
}
