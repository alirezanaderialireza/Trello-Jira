"use client";

// apps/web/src/features/board/components/card-detail/CardDetailModal.tsx
//
// Phase 1.2 (F1.2.4.b) — tab labels now in Persian; comment count shown
// on the «گفت‌وگو» tab; CardComments receives role prop.

import { useCardModal }   from "../../hooks/useCardModal";
import { useBoardStore }  from "../../store/useBoardStore";
import { CardLabels }     from "./CardLabels";
import { CardChecklists } from "./CardChecklists";
import { CardComments }   from "./CardComments";
import { CardDueDate }    from "./CardDueDate";
import { CardActivity }   from "./CardActivity";
import { CardAssignees }  from "./CardAssignees";
import { CardCover }      from "./CardCover";
import { useMemo, useState } from "react";

type Tab = "details" | "comments" | "activity";

const TAB_LABELS: Record<Tab, string> = {
  details:  "جزئیات",
  comments: "گفت‌وگو",
  activity: "فعالیت",
};

// Atomic selector for comment count on this card
const makeSelectCommentCount = (cardId: string) => (s: any): number =>
  (s.commentsByCard[cardId] ?? []).length;

export function CardDetailModal() {
  const { cardId, close } = useCardModal();
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const card = useBoardStore((s) => (cardId ? s.cards[cardId] : null));

  const commentCount = useBoardStore(
    useMemo(() => makeSelectCommentCount(cardId ?? ""), [cardId]),
  ) as number;

  if (!cardId || !card) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 pt-16 pb-8">
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 dir="auto" className="text-lg font-semibold text-white truncate">
            {card.title}
          </h2>
          <button
            onClick={close}
            aria-label="بستن"
            className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab navigation */}
        <div dir="rtl" className="flex border-b border-slate-700 px-6">
          {(["details", "comments", "activity"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-blue-400 text-blue-400"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {TAB_LABELS[tab]}
              {tab === "comments" && commentCount > 0 ? (
                <span className="rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 tabular-nums leading-none">
                  {commentCount.toLocaleString("fa-IR")}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 max-h-[65vh] overflow-y-auto">
          {activeTab === "details" && (
            <div className="space-y-6">
              {/* Description */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
                  توضیحات
                </h3>
                <p className="text-sm text-slate-300">
                  {card.description || "توضیحاتی ثبت نشده است."}
                </p>
              </div>

              {/* Cover */}
              <CardCover cardId={cardId} boardId={card.boardId} />

              {/* Due Date */}
              <CardDueDate cardId={cardId} boardId={card.boardId} />

              {/* Assignees */}
              <CardAssignees cardId={cardId} boardId={card.boardId} role={undefined} />

              {/* Labels */}
              <CardLabels cardId={cardId} boardId={card.boardId} />

              {/* Checklists */}
              <CardChecklists cardId={cardId} boardId={card.boardId} />
            </div>
          )}

          {activeTab === "comments" && (
            <CardComments cardId={cardId} boardId={card.boardId} />
          )}

          {activeTab === "activity" && (
            <CardActivity cardId={cardId} />
          )}
        </div>
      </div>
    </div>
  );
}
