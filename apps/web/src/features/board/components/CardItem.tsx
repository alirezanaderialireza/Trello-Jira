"use client";

import {
  memo,
  useState,
  useRef,
  useEffect,
  useMemo,
  useLayoutEffect,
} from "react";

import { useSortable } from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";

import { Trash2 } from "lucide-react";

import { toast } from "sonner";

import { useBoardStore } from "../store/useBoardStore";
import { useCardTitle } from "../engine/useBoardState";

import { updateCardAction } from "../actions/board.actions";
import { isActionFailure } from "../actions/responseTypes";

import { getTokenStyle }           from "@/lib/labels/tokenColorMap";
import { CardDueDateBadge }        from "@/components/cards/CardDueDateBadge";
import { AttachmentCountBadge }    from "@/components/cards/AttachmentCountBadge";
import { ChecklistProgressBadge }  from "@/components/cards/ChecklistProgressBadge";
import { CardCommentsBadge }       from "@/components/cards/CardCommentsBadge";
import { CardAssigneesBadge }      from "@/components/cards/CardAssigneesBadge";
import { renderBackgroundCss, isBackgroundData } from "@/lib/background";

// ============================================================================
// 🧠 Types
// ============================================================================

interface CardItemProps {
  cardId: string;

  onDeleteCard: (id: string) => void;
}

type UpdateCardPayload = {
  id: string;

  title?: string;

  mutationId: string;
};

// ============================================================================
// 🧠 Store Selectors
// ============================================================================

// 🌟 intentionally preserved
const makeSelectCardUpdatedAt =
  (id: string) => (state: any) =>
    state.cards[id]?.updatedAt;

// Label DTOs needed to render the top-3 colour bars on the card
// preview (D5 + D11 hybrid: small bars on the card, full pill in
// the card detail). The selector reads two slices:
//   • the card's labelId[]
//   • the global label DTO map
// Re-renders are gated by Object.is on the slices themselves —
// adding/removing a label on this card or editing any label on the
// board flips one of the two references, which is exactly when the
// preview needs to re-derive.
const makeSelectCardLabelIds =
  (id: string) => (state: any) =>
    state.cards[id]?.labels;

const selectAllLabels = (state: any) =>
  state.labels;

const MAX_VISIBLE_LABELS = 3;

// Selector for the card's due date (Phase 1.2 — F1.2.2). The DateOnly
// string lives on the card row; the badge handles overdue / today /
// future palette decisions internally.
const makeSelectCardDueDate =
  (id: string) => (state: any) =>
    state.cards[id]?.dueDate ?? null;

// Atomic selector for checklist progress (Phase 1.2 — F1.2.3.b).
const makeSelectChecklistProgress =
  (id: string) =>
  (state: any): { done: number; total: number } => {
    const ids: string[] = state.checklistsByCard[id] ?? [];
    let done = 0;
    let total = 0;
    for (const clId of ids) {
      const cl = state.checklists[clId];
      if (!cl) continue;
      for (const item of cl.items) {
        total++;
        if (item.isDone) done++;
      }
    }
    return { done, total };
  };

// ── Assignees (Phase 1.2 — F1.2.5) ──────────────────────────────────────────
// Atomic selector: card.assignees[] + boardMembers cache.
const makeSelectCardAssigneeIds =
  (id: string) => (state: any): string[] =>
    state.cards[id]?.assignees ?? [];
const selectBoardMembers = (state: any) => state.boardMembers;

// ============================================================================
// 🧠 SSR-safe Layout Effect
// ============================================================================

const useIsomorphicLayoutEffect =
  typeof window !== "undefined"
    ? useLayoutEffect
    : useEffect;

// ============================================================================
// 🚀 CardItem
// ============================================================================

export const CardItem = memo(function CardItem({
  cardId,
  onDeleteCard,
}: CardItemProps) {
  // ==========================================================================
  // Store
  // ==========================================================================

  // Phase 1.3 (F1.3.1) — title now flows through the centralised board-state
  // engine selector instead of an inline factory.
  const cardTitle = useCardTitle(cardId);

  const selectUpdatedAt = useMemo(
    () => makeSelectCardUpdatedAt(cardId),
    [cardId]
  );

  // intentionally kept for future sync logic
  useBoardStore(selectUpdatedAt);

  // ── Labels (top-3 + overflow) ───────────────────────────────────────────
  // The selectors are memoised by cardId so a hot-reload of this
  // component doesn't tear down the Zustand subscription path.
  const selectCardLabelIds = useMemo(
    () => makeSelectCardLabelIds(cardId),
    [cardId],
  );
  const cardLabelIds = useBoardStore(selectCardLabelIds);
  const allLabels = useBoardStore(selectAllLabels);

  const visibleLabels = useMemo(() => {
    if (!cardLabelIds || cardLabelIds.length === 0) return [];
    const list = (cardLabelIds as string[])
      .map((id) => allLabels[id])
      .filter(Boolean)
      .sort(
        (a: { position: string }, b: { position: string }) =>
          a.position.localeCompare(b.position),
      );
    return list as Array<{
      id:         string;
      name:       string;
      colorToken: string;
      position:   string;
    }>;
  }, [cardLabelIds, allLabels]);

  const top3 = visibleLabels.slice(0, MAX_VISIBLE_LABELS);
  const overflowCount = Math.max(0, visibleLabels.length - MAX_VISIBLE_LABELS);

  // ── Due date (Phase 1.2 — F1.2.2) ───────────────────────────────────────
  const selectCardDueDate = useMemo(
    () => makeSelectCardDueDate(cardId),
    [cardId],
  );
  const cardDueDate = useBoardStore(selectCardDueDate) as string | null;

  // ── Checklist progress (Phase 1.2 — F1.2.3.b) ───────────────────────────
  const selectChecklistProgress = useMemo(
    () => makeSelectChecklistProgress(cardId),
    [cardId],
  );
  const checklistProgress = useBoardStore(selectChecklistProgress);

  // ── Comment count (Phase 1.2 — F1.2.4.b) ─────────────────────────────────
  const commentCount = useBoardStore(
    useMemo(
      () => (s: any): number => (s.commentsByCard[cardId] ?? []).length,
      [cardId],
    ),
  ) as number;

  // ── Assignees (Phase 1.2 — F1.2.5) ─────────────────────────────────────
  const selectCardAssigneeIds = useMemo(
    () => makeSelectCardAssigneeIds(cardId),
    [cardId],
  );
  const cardAssigneeIds = useBoardStore(selectCardAssigneeIds) as string[];
  const boardMembers    = useBoardStore(selectBoardMembers);

  // ── Attachment count (Phase 1.2 — F1.2.8) ──────────────────────────────
  const attachmentCount = useBoardStore(
    useMemo(
      () => (s: any): number => s.cards[cardId]?.attachmentCount ?? 0,
      [cardId],
    ),
  ) as number;

  // ── Cover (Phase 1.2 — F1.2.7/F1.2.8) ─────────────────────────────────
  const coverData = useBoardStore(
    useMemo(
      () => (s: any) => s.cards[cardId]?.coverData ?? null,
      [cardId],
    ),
  ) as { type: string; id: string; url?: string } | null;

  const updateCardStore = useBoardStore(
    (s) => s.updateCard
  );

  // ==========================================================================
  // Local State
  // ==========================================================================

  const [isEditing, setIsEditing] =
    useState(false);

  const [title, setTitle] = useState(
    cardTitle || ""
  );

  // ==========================================================================
  // Refs
  // ==========================================================================

  const textareaRef =
    useRef<HTMLTextAreaElement>(null);

  const isSavingRef = useRef(false);

  const dirtyRef = useRef(false);

  const wasDraggingRef = useRef(false);

  const isMountedRef = useRef(true);

  // ==========================================================================
  // DnD Kit
  // ==========================================================================

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: cardId,

    data: {
      type: "Card",
      cardId,
    },

    disabled: isEditing,
  });

  // ==========================================================================
  // Helpers
  // ==========================================================================

  const adjustHeight = () => {
    if (!textareaRef.current) return;

    textareaRef.current.style.height =
      "auto";

    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  };

  const resetEditState = () => {
    if (isMountedRef.current) {
      setIsEditing(false);

      dirtyRef.current = false;
    }

    queueMicrotask(() => {
      if (isMountedRef.current) {
        isSavingRef.current = false;
      }
    });
  };

  // ==========================================================================
  // Mount Lifecycle
  // ==========================================================================

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ==========================================================================
  // Auto Resize
  // ==========================================================================

  useIsomorphicLayoutEffect(() => {
    if (isEditing) {
      adjustHeight();
    }
  }, [title, isEditing]);

  // ==========================================================================
  // External Sync
  // ==========================================================================

  useEffect(() => {
    if (
      typeof cardTitle === "string" &&
      !isEditing &&
      !dirtyRef.current
    ) {
      setTitle(cardTitle);
    }
  }, [cardTitle, isEditing]);

  // ==========================================================================
  // Drag State Tracking
  // ==========================================================================

  useEffect(() => {
    if (isDragging) {
      wasDraggingRef.current = true;
    } else {
      const timer = setTimeout(() => {
        wasDraggingRef.current = false;
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [isDragging]);

  // ==========================================================================
  // Save Handler
  // ==========================================================================

  const handleSave = async () => {
    if (
      isSavingRef.current ||
      !isEditing
    ) {
      return;
    }

    isSavingRef.current = true;

    const trimmedTitle = title.trim();

    const latestCard =
      useBoardStore.getState().cards[
        cardId
      ];

    if (!latestCard) {
      resetEditState();

      return;
    }

    // ------------------------------------------------------------------------
    // Nothing Changed
    // ------------------------------------------------------------------------

    if (
      !trimmedTitle ||
      trimmedTitle === latestCard.title
    ) {
      if (isMountedRef.current) {
        setTitle(latestCard.title);
      }

      resetEditState();

      return;
    }

    // ------------------------------------------------------------------------
    // Optimistic Update
    // ------------------------------------------------------------------------

    const previousTitle =
      latestCard.title;

    updateCardStore(cardId, {
      title: trimmedTitle,
    });

    try {
      const payload: UpdateCardPayload =
        {
          id: cardId,

          title: trimmedTitle,

          mutationId:
            crypto.randomUUID(),
        };

      const result =
        await updateCardAction(payload);

      // ----------------------------------------------------------------------
      // SafeAction Layer
      // ----------------------------------------------------------------------

      if (isActionFailure(result)) {
        throw new Error(
          result.message ||
            "Server rejected the update."
        );
      }

      // ----------------------------------------------------------------------
      // Domain Layer
      // ----------------------------------------------------------------------
      // Cast result.data to a flat structural type with every field
      // optional. This deliberately avoids the discriminated-union
      // narrowing path entirely: under apps/web's relaxed tsconfig
      // (strict: true inherited but strictNullChecks: false), TS's flow
      // analyser refuses to narrow ClientCardMutationResult on either
      // `result.data.success` or a local-const-bound `domainResult.success`,
      // which made the production build fail with
      //   Property 'message' does not exist on type
      //     '{ success: true; cardId: string; ... } | { success: false; ... }'.
      // A flat shape with `message?: string` removes the need to narrow:
      // the field is always reachable, returns string | undefined, and
      // the runtime check (!domainResult.success) still gates the throw.
      // This mirrors the cast pattern BoardView.tsx already uses for
      // moveListAction's response.

      const domainResult = result.data as {
        success: boolean;
        message?: string;
      };

      if (!domainResult.success) {
        throw new Error(
          domainResult.message ||
            "Domain rejected the update."
        );
      }
    } catch (error: any) {
      toast.error(
        error?.message ||
          "Failed to save card title."
      );

      // ----------------------------------------------------------------------
      // Rollback
      // ----------------------------------------------------------------------

      const stillExists =
        useBoardStore.getState().cards[
          cardId
        ];

      if (stillExists) {
        updateCardStore(cardId, {
          title: previousTitle,
        });
      }

      if (isMountedRef.current) {
        setTitle(previousTitle);
      }
    }

    resetEditState();
  };

  // ==========================================================================
  // Keyboard Handling
  // ==========================================================================

  const handleKeyDown = (
    e: React.KeyboardEvent
  ) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey
    ) {
      e.preventDefault();

      handleSave();
    }

    if (e.key === "Escape") {
      const latestCard =
        useBoardStore.getState().cards[
          cardId
        ];

      if (
        isMountedRef.current &&
        latestCard
      ) {
        setTitle(latestCard.title);

        setIsEditing(false);

        dirtyRef.current = false;
      }
    }
  };

  // ==========================================================================
  // Styles
  // ==========================================================================

  const style = useMemo(
    () => ({
      transform:
        CSS.Translate.toString(
          transform
        ),

      transition,
    }),
    [transform, transition]
  );

  // ==========================================================================
  // Guard
  // ==========================================================================

  if (typeof cardTitle !== "string") {
    return null;
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        group
        relative
        bg-white
        p-3
        rounded-lg
        border
        border-gray-200
        text-sm
        text-gray-700
        hover:border-blue-400
        hover:ring-1
        hover:ring-blue-400
        transition-all
        overflow-hidden
        ${coverData ? "pt-12" : ""}
        ${
          isDragging
            ? "opacity-50 rotate-3 scale-105 will-change-transform"
            : ""
        }
        ${
          isEditing
            ? "ring-2 ring-blue-500 border-blue-500 z-10"
            : ""
        }
      `}
    >
      {/* Cover strip (Phase 1.2 — F1.2.7/F1.2.8) */}
      {coverData ? (
        <div
          className="absolute inset-x-0 top-0 h-10 rounded-t-lg"
          aria-hidden="true"
          style={
            coverData.type === "image" && coverData.url
              ? {
                  backgroundImage:    `url(${coverData.url})`,
                  backgroundSize:     "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        />
      ) : null}

      {/* ================================================================== */}
      {/* Cover Strip (Phase 1.2 — F1.2.7) */}
      {/* ================================================================== */}

      {isBackgroundData(coverData) ? (
        <div
          className="absolute inset-x-0 top-0 h-10 rounded-t-lg"
          style={{ background: renderBackgroundCss(coverData) }}
          aria-hidden="true"
        />
      ) : null}
      {/* ================================================================== */}
      {/* Labels (top-3 visible + +N overflow per D5) */}
      {/* ================================================================== */}

      {visibleLabels.length > 0 && (
        <div
          className="mb-2 flex flex-wrap items-center gap-1"
          aria-label="برچسب‌های کارت"
        >
          {top3.map((label) => {
            const tokenStyle = getTokenStyle(label.colorToken);
            return (
              <span
                key={label.id}
                role="img"
                aria-label={`${tokenStyle.persianName}: ${label.name}`}
                title={label.name}
                dir="auto"
                style={{
                  backgroundColor: tokenStyle.bg,
                  color:           tokenStyle.text,
                }}
                className="inline-block h-2 w-10 rounded-full"
              >
                <span className="sr-only">{label.name}</span>
              </span>
            );
          })}
          {overflowCount > 0 && (
            <span
              aria-label={`${overflowCount.toLocaleString("fa-IR")} برچسب دیگر`}
              className="inline-flex items-center rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium leading-none text-slate-600"
            >
              {`+${overflowCount.toLocaleString("fa-IR")}`}
            </span>
          )}
        </div>
      )}

      {/* ================================================================== */}
      {/* Due Date Badge (Phase 1.2 — F1.2.2) */}
      {/* ================================================================== */}

      {cardDueDate ? (
        <div className="mb-2">
          <CardDueDateBadge dueDate={cardDueDate} size="sm" />
        </div>
      ) : null}

      {/* ================================================================== */}
      {/* Checklist Progress Badge (Phase 1.2 — F1.2.3.b) */}
      {/* ================================================================== */}

      {checklistProgress.total > 0 ? (
        <div className="mb-2">
          <ChecklistProgressBadge
            done={checklistProgress.done}
            total={checklistProgress.total}
          />
        </div>
      ) : null}

      {/* ================================================================== */}
      {/* Comments Badge (Phase 1.2 — F1.2.4.b) */}
      {/* ================================================================== */}

      {commentCount > 0 ? (
        <div className="mb-2">
          <CardCommentsBadge count={commentCount} />
        </div>
      ) : null}

      {/* Attachments Badge (Phase 1.2 — F1.2.8) */}
      {attachmentCount > 0 ? (
        <div className="mb-2">
          <AttachmentCountBadge count={attachmentCount} />
        </div>
      ) : null}

      {/* ================================================================== */}
      {/* Assignees Badge (Phase 1.2 — F1.2.5) */}
      {/* ================================================================== */}

      {cardAssigneeIds.length > 0 ? (
        <div className="mb-2">
          <CardAssigneesBadge
            assigneeIds={cardAssigneeIds}
            members={boardMembers}
          />
        </div>
      ) : null}

      {/* ================================================================== */}
      {/* Edit Mode */}
      {/* ================================================================== */}

      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={title}
          autoFocus
          rows={1}
          className="w-full resize-none outline-none overflow-hidden bg-transparent font-medium"
          onFocus={(e) => {
            const target = e.target;

            requestAnimationFrame(() => {
              target.selectionStart =
                target.value.length;

              target.selectionEnd =
                target.value.length;
            });
          }}
          onChange={(e) => {
            setTitle(e.target.value);

            dirtyRef.current = true;
          }}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
        />
      ) : (
        // ================================================================
        // View Mode
        // ================================================================
        <div
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={0}
          aria-label={`Card: ${cardTitle}`}
          className="cursor-grab active:cursor-grabbing font-medium whitespace-pre-wrap break-words min-h-[20px]"
          onDoubleClick={() => {
            if (
              wasDraggingRef.current
            ) {
              return;
            }

            setIsEditing(true);
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" ||
              e.key === " "
            ) {
              e.preventDefault();

              setIsEditing(true);
            }
          }}
        >
          {cardTitle}
        </div>
      )}

      {/* ================================================================== */}
      {/* Delete Button */}
      {/* ================================================================== */}

      {!isEditing && (
        <button
          aria-label="حذف کارت"
          className="absolute top-2 end-2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          onPointerDown={(e) => {
            e.stopPropagation();

            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();

            onDeleteCard(cardId);
          }}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
});