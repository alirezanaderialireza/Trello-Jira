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

import { updateCardAction } from "../actions/board.actions";
import { isActionFailure } from "../actions/responseTypes";

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

const makeSelectCardTitle =
  (id: string) => (state: any) =>
    state.cards[id]?.title;

// 🌟 intentionally preserved
const makeSelectCardUpdatedAt =
  (id: string) => (state: any) =>
    state.cards[id]?.updatedAt;

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

  const selectTitle = useMemo(
    () => makeSelectCardTitle(cardId),
    [cardId]
  );

  const selectUpdatedAt = useMemo(
    () => makeSelectCardUpdatedAt(cardId),
    [cardId]
  );

  const cardTitle =
    useBoardStore(selectTitle);

  // intentionally kept for future sync logic
  useBoardStore(selectUpdatedAt);

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
      // Bind result.data to a local const before narrowing.
      // Property-access narrowing (`result.data.success` →
      // `result.data.message`) is unreliable in apps/web's TS config
      // (strictNullChecks: false): TS forgets the discriminator on the
      // second access and falls back to the full union, raising
      //   Property 'message' does not exist on type 'ClientCardMutationResult'.
      // A local const stabilises the narrow.

      const domainResult = result.data as
        | {
            success: true;
            cardId: string;
            listRevision: number;
            boardSequence: string;
            projectionSequence: string;
            aclVersion?: number;
          }
        | {
            success: false;
            reason: string;
            retryable: boolean;
            message: string;
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
          aria-label="Delete card"
          className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
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