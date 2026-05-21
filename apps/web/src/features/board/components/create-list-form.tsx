"use client";

// apps/web/src/features/board/components/create-list-form.tsx
//
// Fixes applied:
// ✅ #12: Removed all `(s: any)` casts on store selectors.
//         BoardStoreActions is fully typed; using explicit selector types.

import { useState, useRef, useEffect } from "react";
import { Plus, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { createListAction } from "../actions/board.actions";
import { useBoardStore, type ListDto } from "../store/useBoardStore";

// ============================================================================
// Helpers
// ============================================================================

const generateOptimisticPosition = (lastPos?: string | null): string => {
  if (!lastPos) return "a000";
  return `${lastPos}V`;
};

// ============================================================================
// Component
// ============================================================================

export default function CreateListForm({ boardId }: { boardId: string }) {
  const [isEditing,    setIsEditing]    = useState(false);
  const [title,        setTitle]        = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSubmittingRef    = useRef(false);
  const isMountedRef       = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // =========================================================================
  // Store selectors — typed (no `any`) ✅ #12
  // =========================================================================

  const addListStore     = useBoardStore((s) => s.addList);
  const replaceListStore = useBoardStore((s) => s.replaceList);
  const removeListStore  = useBoardStore((s) => s.deleteList);

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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMessage("List title cannot be empty.");
      return;
    }
    if (isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setErrorMessage(null);

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const currentSignal = abortControllerRef.current.signal;

    // -----------------------------------------------------------------------
    // Read store snapshot (typed)
    // -----------------------------------------------------------------------
    const state          = useBoardStore.getState();
    const lastListId     = state.listOrder[state.listOrder.length - 1];
    const lastListPos    = lastListId ? state.lists[lastListId]?.position : undefined;

    // -----------------------------------------------------------------------
    // Optimistic entity
    // -----------------------------------------------------------------------
    const optimisticPosition = generateOptimisticPosition(lastListPos);
    const tempId             = `temp-list-${globalThis.crypto.randomUUID()}`;

    const optimisticList: Partial<ListDto> & { id: string; cards: never[] } = {
      id:           tempId,
      title:        trimmedTitle,
      position:     optimisticPosition,
      revision:     0,
      isOptimistic: true,
      cards:        [],
    };

    addListStore(optimisticList);

    setTitle("");
    setIsEditing(false);

    try {
      const result = await createListAction({
        boardId,
        title: trimmedTitle,
        mutationId: globalThis.crypto.randomUUID(),
      });

      if (!isMountedRef.current || currentSignal.aborted) return;

      if (!result.success) {
        throw new Error(result.message ?? "Failed to create list.");
      }

      if (!result.data.success) {
        throw new Error(
          (result.data as any).message ?? "List creation rejected.",
        );
      }

      const confirmedList: Partial<ListDto> = {
        id:           result.data.listId,
        title:        trimmedTitle,
        position:     optimisticPosition,
        revision:     result.data.boardRevision,
        isOptimistic: false,
      };

      replaceListStore(tempId, confirmedList);
      toast.success("List created.");
    } catch (error) {
      if (!isMountedRef.current || currentSignal.aborted) return;

      const message = error instanceof Error ? error.message : "Network error.";
      removeListStore(tempId);
      setTitle(trimmedTitle);
      setIsEditing(true);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      if (isMountedRef.current && !currentSignal.aborted) {
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="Enter list title..."
            aria-label="Enter list title"
            aria-invalid={!!errorMessage}
            className={`w-full text-sm p-2 rounded-lg border outline-none transition-all font-semibold ${
              errorMessage
                ? "border-red-500 focus:border-red-600 bg-red-50/50"
                : "border-gray-300 focus:border-blue-500"
            }`}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleClose();
            }}
          />

          {errorMessage && (
            <div className="flex items-center gap-1.5 text-red-600 text-xs font-medium px-1">
              <AlertCircle size={14} />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isSubmittingRef.current}
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
