"use client";

import { useState, useRef, useEffect } from "react";

import {
  Plus,
  X,
  AlertCircle,
} from "lucide-react";

import { toast } from "sonner";

import { createListAction } from "../actions/board.actions";
import { isActionFailure } from "../actions/responseTypes";

import { useBoardStore } from "../store/useBoardStore";

// ============================================================================
// 🧠 Temporary Optimistic Position
// ============================================================================

const generateOptimisticPosition = (
  lastPos?: string | null
) => {
  if (!lastPos) {
    return "a000";
  }

  return `${lastPos}V`;
};

// ============================================================================
// 🚀 Component
// ============================================================================

export default function CreateListForm({
  boardId,
}: {
  boardId: string;
}) {
  const [isEditing, setIsEditing] =
    useState(false);

  const [title, setTitle] = useState("");

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const isSubmittingRef = useRef(false);

  const isMountedRef = useRef(true);

  const abortControllerRef =
    useRef<AbortController | null>(null);

  // =========================================================================
  // 🌟 Store Access
  // =========================================================================

  /**
   * چون تایپ استور هنوز کامل sync نشده،
   * فعلاً any استفاده می‌کنیم تا ts2345 رفع شود.
   */

  const addListStore = useBoardStore(
    (s: any) => s.addList
  );

  const replaceListStore = useBoardStore(
    (s: any) => s.replaceList
  );

  const removeListStore = useBoardStore(
    (s: any) => s.deleteList
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
  // Submit
  // =========================================================================

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setErrorMessage(
        "List title cannot be empty."
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
    // Read Store Snapshot
    // =========================================================================

    const state =
      useBoardStore.getState() as any;

    const lastListId =
      state.listOrder[
        state.listOrder.length - 1
      ];

    const lastListPosition = lastListId
      ? state.lists[lastListId]?.position
      : undefined;

    // =========================================================================
    // Optimistic Entity
    // =========================================================================

    const optimisticPosition =
      generateOptimisticPosition(
        lastListPosition
      );

    const tempId = `temp-list-${crypto.randomUUID()}`;

    const optimisticList = {
      id: tempId,

      boardId,

      title: trimmedTitle,

      position: optimisticPosition,

      cards: [],

      revision: 0,

      isOptimistic: true,
    };

    // optimistic insert
    addListStore(optimisticList);

    // reset ui
    setTitle("");

    setIsEditing(false);

    try {
      const result = await createListAction({
        boardId,

        title: trimmedTitle,

        mutationId: crypto.randomUUID(),
      });

      if (
        !isMountedRef.current ||
        currentSignal.aborted
      ) {
        return;
      }

      // transport layer failure
      if (isActionFailure(result)) {
        throw new Error(
          result.message ||
            "Failed to create list."
        );
      }

      // domain layer failure
      // Cast result.data to a flat structural type with every field
      // optional (success-branch fields included for the reconciliation
      // step below). This avoids the discriminated-union narrowing path:
      // under apps/web's relaxed tsconfig (strictNullChecks: false), TS
      // refuses to narrow on `domainResult.success` even when bound to
      // a local const, breaking the production build with
      //   Property 'message' does not exist on type
      //     '{ success: true; ... } | { success: false; ... }'.
      // A flat shape makes every access valid; the runtime check still
      // gates the throw, and on the success path the optional fields
      // resolve under strictNullChecks: false.
      const domainResult = result.data as {
        success: boolean;
        message?: string;
        listId?: string;
        boardRevision?: number;
      };

      if (!domainResult.success) {
        throw new Error(
          domainResult.message ||
            "List creation rejected."
        );
      }

      // =========================================================================
      // Reconciliation
      // =========================================================================

      const confirmedList = {
        id: domainResult.listId,

        boardId,

        title: trimmedTitle,

        position: optimisticPosition,

        cards: [],

        revision:
          domainResult.boardRevision,

        isOptimistic: false,
      };

      replaceListStore(
        tempId,
        confirmedList
      );

      toast.success("List created.");
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

      // rollback optimistic update
      removeListStore(tempId);

      // restore form
      setTitle(trimmedTitle);

      setIsEditing(true);

      setErrorMessage(message);

      toast.error(message);
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
  // Form UI
  // =========================================================================

  if (isEditing) {
    return (
      <div className="w-72 shrink-0 bg-gray-100 rounded-xl p-2 h-fit shadow-sm border border-gray-200">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-2"
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);

              if (errorMessage) {
                setErrorMessage(null);
              }
            }}
            placeholder="Enter list title..."
            aria-label="Enter list title"
            aria-invalid={!!errorMessage}
            className={`w-full text-sm p-2 rounded-lg border outline-none transition-all font-semibold
              ${
                errorMessage
                  ? "border-red-500 focus:border-red-600 bg-red-50/50"
                  : "border-gray-300 focus:border-blue-500"
              }
            `}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                handleClose();
              }
            }}
          />

          {errorMessage && (
            <div className="flex items-center gap-1.5 text-red-600 text-xs font-medium px-1 animate-in fade-in slide-in-from-top-1">
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
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-wait text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              Add list
            </button>

            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </form>
      </div>
    );
  }

  // =========================================================================
  // Idle UI
  // =========================================================================

  return (
    <button
      onClick={() => setIsEditing(true)}
      aria-label="Add another list"
      className="w-72 shrink-0 flex items-center gap-2 bg-white/50 hover:bg-white/80 backdrop-blur-sm text-gray-700 p-4 rounded-xl text-sm font-semibold transition-all border border-dashed border-gray-300 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <Plus className="w-5 h-5" />

      Add another list
    </button>
  );
}