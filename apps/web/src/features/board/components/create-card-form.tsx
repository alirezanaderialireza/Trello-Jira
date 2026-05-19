"use client";

import { useState, useRef, useEffect } from "react";
import {
  Plus,
  X,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

import { createCardAction } from "../actions/board.actions";
import { useBoardStore } from "../store/useBoardStore";

// ============================================================================
// 🧠 Helpers
// ============================================================================

const generateOptimisticPosition = (
  lastPos?: string | null
) => {
  if (!lastPos) return "a000";

  return `${lastPos}V`;
};

// ============================================================================
// 🧩 Types
// ============================================================================

type BoardCard = {
  id: string;

  boardId: string;

  listId: string;

  title: string;

  position: string;

  revision: number;

  isOptimistic?: boolean;
};

type BoardStore = {
  cards: Record<string, BoardCard>;

  cardsByList: Record<string, string[]>;

  addCard: (card: BoardCard) => void;

  deleteCard: (id: string) => void;

  replaceCard: (
    tempId: string,
    card: BoardCard
  ) => void;
};

// ============================================================================
// 🚀 Component
// ============================================================================

export default function CreateCardForm({
  listId,
  boardId,
}: {
  listId: string;
  boardId: string;
}) {
  const [isEditing, setIsEditing] =
    useState(false);

  const [title, setTitle] = useState("");

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const isSubmittingRef = useRef(false);

  const textareaRef =
    useRef<HTMLTextAreaElement>(null);

  const isMountedRef = useRef(true);

  const abortControllerRef =
    useRef<AbortController | null>(null);

  // =========================================================================
  // 🌟 Typed Store Access
  // =========================================================================

  const addCardStore = useBoardStore(
    (s: BoardStore) => s.addCard
  );

  const deleteCardStore = useBoardStore(
    (s: BoardStore) => s.deleteCard
  );

  const replaceCardStore = useBoardStore(
    (s: BoardStore) => s.replaceCard
  );

  // =========================================================================
  // Lifecycle
  // =========================================================================

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      abortControllerRef.current?.abort();
    };
  }, []);

  // =========================================================================
  // Auto Resize
  // =========================================================================

  const adjustHeight = (
    el: HTMLTextAreaElement
  ) => {
    el.style.height = "auto";

    el.style.height = `${el.scrollHeight}px`;
  };

  // =========================================================================
  // Submit
  // =========================================================================

  const handleSubmit = async (
    e:
      | React.FormEvent
      | React.KeyboardEvent
  ) => {
    e.preventDefault();

    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setErrorMessage(
        "Title cannot be empty."
      );

      return;
    }

    if (isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;

    setErrorMessage(null);

    // cancel previous request
    abortControllerRef.current?.abort();

    abortControllerRef.current =
      new AbortController();

    const currentSignal =
      abortControllerRef.current.signal;

    // =========================================================================
    // Read Current Store State
    // =========================================================================

    const state =
      useBoardStore.getState() as BoardStore;

    const listCardIds =
      state.cardsByList[listId] || [];

    const lastCardId =
      listCardIds[
        listCardIds.length - 1
      ];

    const lastCardPosition = lastCardId
      ? state.cards[lastCardId]?.position
      : undefined;

    // =========================================================================
    // Optimistic Card
    // =========================================================================

    const optimisticPosition =
      generateOptimisticPosition(
        lastCardPosition
      );

    const tempId = `temp-card-${crypto.randomUUID()}`;

    const optimisticCard: BoardCard = {
      id: tempId,

      boardId,

      listId,

      title: trimmedTitle,

      position: optimisticPosition,

      revision: 0,

      isOptimistic: true,
    };

    // optimistic insert
    addCardStore(optimisticCard);

    // reset ui
    setTitle("");

    if (textareaRef.current) {
      textareaRef.current.style.height =
        "auto";
    }

    try {
      const result =
        await createCardAction({
          listId,

          title: trimmedTitle,

          mutationId:
            crypto.randomUUID(),
        });

      if (
        !isMountedRef.current ||
        currentSignal.aborted
      ) {
        return;
      }

      // transport layer failure
      if (!result.success) {
        throw new Error(
          result.message ||
            "Failed to create card."
        );
      }

      // domain layer failure
      if (!result.data.success) {
        throw new Error(
          result.data.message ||
            "Card creation rejected."
        );
      }

      // =========================================================================
      // Reconciliation
      // =========================================================================

      const confirmedCard: BoardCard = {
        id: result.data.cardId,

        boardId,

        listId,

        title: trimmedTitle,

        position: optimisticPosition,

        revision:
          result.data.listRevision,

        isOptimistic: false,
      };

      replaceCardStore(
        tempId,
        confirmedCard
      );

      toast.success("Card created.");

    } catch (error) {
      if (
        !isMountedRef.current ||
        currentSignal.aborted
      ) {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : "Network error.";

      // rollback optimistic insert
      deleteCardStore(tempId);

      // restore form state
      setTitle(trimmedTitle);

      setErrorMessage(message);

      toast.error(message);

      setTimeout(() => {
        textareaRef.current?.focus();
      }, 10);

    } finally {
      if (
        isMountedRef.current &&
        !currentSignal.aborted
      ) {
        isSubmittingRef.current = false;
      }
    }
  };

  // =========================================================================
  // Close
  // =========================================================================

  const handleClose = () => {
    setIsEditing(false);

    setTitle("");

    setErrorMessage(null);

    abortControllerRef.current?.abort();
  };

  // =========================================================================
  // Editing UI
  // =========================================================================

  if (isEditing) {
    return (
      <form
        onSubmit={handleSubmit}
        className="mt-2 flex flex-col gap-2"
      >
        <textarea
          ref={textareaRef}
          autoFocus
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);

            adjustHeight(e.target);

            if (errorMessage) {
              setErrorMessage(null);
            }
          }}
          placeholder="Enter a title for this card..."
          aria-label="Enter card title"
          aria-invalid={!!errorMessage}
          aria-describedby={
            errorMessage
              ? "card-title-error"
              : undefined
          }
          className={`w-full text-sm p-2.5 border rounded-lg shadow-sm outline-none resize-none overflow-hidden min-h-[70px] transition-colors
            ${
              errorMessage
                ? "border-red-500 focus:border-red-600 bg-red-50/30"
                : "border-gray-300 focus:border-blue-500"
            }
          `}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey
            ) {
              e.preventDefault();

              void handleSubmit(e);
            }

            if (e.key === "Escape") {
              handleClose();
            }
          }}
        />

        {errorMessage && (
          <div
            id="card-title-error"
            className="flex items-center gap-1.5 text-red-600 text-xs font-medium px-1 animate-in fade-in slide-in-from-top-1"
          >
            <AlertCircle size={14} />

            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={
              isSubmittingRef.current
            }
            aria-label="Submit new card"
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-wait text-white px-3 py-1.5 rounded text-sm font-medium transition-colors"
          >
            Add card
          </button>

          <button
            type="button"
            onClick={handleClose}
            aria-label="Cancel card creation"
            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </form>
    );
  }

  // =========================================================================
  // Idle UI
  // =========================================================================

  return (
    <button
      onClick={() => setIsEditing(true)}
      aria-label="Add a new card to this list"
      className="w-full flex items-center gap-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 p-2 rounded-lg text-sm font-medium transition-colors mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <Plus className="w-4 h-4" />

      Add a card
    </button>
  );
}