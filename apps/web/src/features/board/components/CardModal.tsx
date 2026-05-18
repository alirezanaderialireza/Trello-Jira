"use client";

import {
  useEffect,
  useRef,
  useState,
  memo,
  useLayoutEffect,
} from "react";

import {
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";

import { toast } from "sonner";

import { useBoardStore } from "../store/useBoardStore";
import { updateCardAction } from "../actions/board.actions";
import { useCardModal } from "../hooks/useCardModal";

// ============================================================================
// 🧠 Types
// ============================================================================

type SyncStatusType =
  | "idle"
  | "saving"
  | "synced"
  | "error"
  | "conflicted";

type UpdatePayload = {
  id: string;
  mutationId: string;
  title?: string;
  description?: string;
};

// ============================================================================
// 🧠 1. Custom Hook: Field Sync Engine
// ============================================================================

function useFieldSync(
  cardId: string,
  field: "title" | "description",
  storeValue: string
) {
  const [value, setValue] = useState(storeValue || "");

  const [status, setStatus] =
    useState<SyncStatusType>("idle");

  const isDirtyRef = useRef(false);

  const saveVersionRef = useRef(0);

  const latestValueRef = useRef(storeValue || "");

  const isMountedRef = useRef(true);

  const debounceTimerRef =
    useRef<NodeJS.Timeout | null>(null);

  const statusTimerRef =
    useRef<NodeJS.Timeout | null>(null);

  // ========================================================================
  // Store Selectors
  // ========================================================================

  const updateCardStore = useBoardStore(
    (s) => s.updateCard
  );

  // ========================================================================
  // Helpers
  // ========================================================================

  const clearStatusTimer = () => {
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);

      statusTimerRef.current = null;
    }
  };

  // ========================================================================
  // External Sync
  // ========================================================================

  useEffect(() => {
    if (!isDirtyRef.current && storeValue !== value) {
      setValue(storeValue || "");

      latestValueRef.current = storeValue || "";
    }
  }, [storeValue, cardId, value]);

  // ========================================================================
  // Save Logic
  // ========================================================================

  const saveToNetwork = async (newValue: string) => {
    const latestServerCard =
      useBoardStore.getState().cards[cardId];

    if (!latestServerCard) return;

    if (newValue === latestServerCard[field]) {
      isDirtyRef.current = false;

      return;
    }

    const currentVersion = ++saveVersionRef.current;

    if (isMountedRef.current) {
      setStatus("saving");
    }

    clearStatusTimer();

    const previousSnapshotValue =
      latestServerCard[field] || "";

    // ====================================================================
    // Optimistic Update
    // ====================================================================

    updateCardStore(cardId, {
      [field]: newValue,
    });

    try {
      const payload: UpdatePayload = {
        id: cardId,
        mutationId: crypto.randomUUID(),
        [field]: newValue,
      };

      const result = await updateCardAction(payload);

      if (!isMountedRef.current) return;

      // ------------------------------------------------------------
      // SafeAction Layer
      // ------------------------------------------------------------

      if (!result.success) {
        if (
          result.message?.includes("CONFLICT")
        ) {
          setStatus("conflicted");

          toast.warning(
            "Conflict detected. Someone else updated this card."
          );
        } else {
          throw new Error(
            result.message || "Update failed."
          );
        }

        return;
      }

      // ------------------------------------------------------------
      // Domain Layer
      // ------------------------------------------------------------

      if (
        result.data &&
        typeof result.data === "object" &&
        "success" in result.data &&
        !result.data.success
      ) {
        if (
          result.data.reason ===
          "SYNC_CONFLICT"
        ) {
          setStatus("conflicted");

          toast.warning(
            "Conflict detected. Please refresh."
          );

          return;
        }

        throw new Error(
          result.data.message ||
            "Domain update failed."
        );
      }

      // ------------------------------------------------------------
      // Success
      // ------------------------------------------------------------

      if (currentVersion === saveVersionRef.current) {
        setStatus("synced");

        statusTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            setStatus("idle");
          }
        }, 2000);

        queueMicrotask(() => {
          isDirtyRef.current = false;
        });
      }
    } catch (error: any) {
      if (!isMountedRef.current) return;

      if (currentVersion === saveVersionRef.current) {
        setStatus("error");

        const stillExists =
          useBoardStore.getState().cards[
            cardId
          ];

        // Rollback
        if (stillExists) {
          updateCardStore(cardId, {
            [field]: previousSnapshotValue,
          });
        }

        setValue(previousSnapshotValue);

        isDirtyRef.current = false;

        toast.error(
          `Failed to save ${field}. Changes rolled back.`
        );
      }
    }
  };

  // ========================================================================
  // Change Handler
  // ========================================================================

  const handleChange = (newVal: string) => {
    setValue(newVal);

    latestValueRef.current = newVal;

    isDirtyRef.current = true;

    setStatus("saving");

    clearStatusTimer();

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      saveToNetwork(newVal);
    }, 800);
  };

  // ========================================================================
  // Blur Handler
  // ========================================================================

  const handleBlur = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (isDirtyRef.current) {
      saveToNetwork(latestValueRef.current);
    }
  };

  // ========================================================================
  // Cleanup
  // ========================================================================

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      clearStatusTimer();

      saveVersionRef.current++;

      // Fire-and-forget emergency save
      if (isDirtyRef.current) {
        updateCardAction({
          id: cardId,
          mutationId: crypto.randomUUID(),
          [field]: latestValueRef.current,
        }).catch(() => {});
      }
    };
  }, [cardId, field]);

  return {
    value,
    handleChange,
    handleBlur,
    status,
  };
}

// ============================================================================
// 🧠 2. Sync Status
// ============================================================================

const SyncStatus = ({
  status,
}: {
  status: SyncStatusType;
}) => {
  if (status === "saving") {
    return (
      <Loader2
        className="w-4 h-4 text-blue-500 animate-spin"
        aria-label="Saving..."
      />
    );
  }

  if (status === "synced") {
    return (
      <CheckCircle2
        className="w-4 h-4 text-green-500"
        aria-label="Saved successfully"
      />
    );
  }

  if (status === "error") {
    return (
      <AlertCircle
        className="w-4 h-4 text-red-500"
        aria-label="Error saving"
      />
    );
  }

  if (status === "conflicted") {
    return (
      <AlertTriangle
        className="w-4 h-4 text-yellow-500 animate-pulse"
        aria-label="Version conflict"
      />
    );
  }

  return null;
};

// ============================================================================
// 🧠 3. Isomorphic Layout Effect
// ============================================================================

const useIsomorphicLayoutEffect =
  typeof window !== "undefined"
    ? useLayoutEffect
    : useEffect;

// ============================================================================
// 📝 4. Title Editor
// ============================================================================

const TitleEditor = memo(
  ({
    cardId,
    initialTitle,
  }: {
    cardId: string;
    initialTitle: string;
  }) => {
    const {
      value,
      handleChange,
      handleBlur,
      status,
    } = useFieldSync(
      cardId,
      "title",
      initialTitle
    );

    const textareaRef =
      useRef<HTMLTextAreaElement>(null);

    const adjustHeight = () => {
      if (!textareaRef.current) return;

      textareaRef.current.style.height = "auto";

      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    };

    useIsomorphicLayoutEffect(() => {
      if (!textareaRef.current) return;

      textareaRef.current.focus();

      textareaRef.current.selectionStart =
        textareaRef.current.value.length;
    }, []);

    useIsomorphicLayoutEffect(() => {
      adjustHeight();
    }, [value]);

    return (
      <div className="flex items-start gap-2 mb-4">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) =>
            handleChange(e.target.value)
          }
          onBlur={handleBlur}
          rows={1}
          aria-label="Card Title"
          className="text-xl font-bold w-full bg-transparent border-none outline-none resize-none overflow-hidden focus:ring-2 focus:ring-blue-500 rounded p-1"
        />

        <SyncStatus status={status} />
      </div>
    );
  }
);

TitleEditor.displayName = "TitleEditor";

// ============================================================================
// 📝 5. Description Editor
// ============================================================================

const DescriptionEditor = memo(
  ({
    cardId,
    initialDesc,
  }: {
    cardId: string;
    initialDesc: string;
  }) => {
    const {
      value,
      handleChange,
      handleBlur,
      status,
    } = useFieldSync(
      cardId,
      "description",
      initialDesc
    );

    const textareaRef =
      useRef<HTMLTextAreaElement>(null);

    const adjustHeight = () => {
      if (!textareaRef.current) return;

      textareaRef.current.style.height = "auto";

      textareaRef.current.style.height = `${Math.max(
        textareaRef.current.scrollHeight,
        120
      )}px`;
    };

    useIsomorphicLayoutEffect(() => {
      adjustHeight();
    }, [value]);

    return (
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-semibold text-gray-700">
            Description
          </h3>

          <SyncStatus status={status} />
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) =>
            handleChange(e.target.value)
          }
          onBlur={handleBlur}
          placeholder="Add a more detailed description..."
          aria-label="Card Description"
          className="w-full min-h-[120px] p-3 bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none resize-none overflow-hidden"
        />
      </div>
    );
  }
);

DescriptionEditor.displayName =
  "DescriptionEditor";

// ============================================================================
// 🪟 6. Main Modal
// ============================================================================

export default function CardModal() {
  const {
    cardId: activeCardId,
    close: closeCardModal,
  } = useCardModal();

  const title = useBoardStore((s) =>
    activeCardId
      ? s.cards[activeCardId]?.title
      : null
  );

  const description = useBoardStore((s) =>
    activeCardId
      ? s.cards[activeCardId]?.description
      : null
  );

  const listId = useBoardStore((s) =>
    activeCardId
      ? s.cards[activeCardId]?.listId
      : null
  );

  const listTitle = useBoardStore((s) =>
    listId ? s.lists[listId]?.title : ""
  );

  const modalRef =
    useRef<HTMLDivElement>(null);

  // ========================================================================
  // Body Scroll Lock
  // ========================================================================

  useEffect(() => {
    if (!activeCardId) return;

    const originalOverflow =
      window.getComputedStyle(document.body)
        .overflow;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow =
        originalOverflow;
    };
  }, [activeCardId]);

  // ========================================================================
  // Focus Trap
  // ========================================================================

  useEffect(() => {
    if (!activeCardId || !modalRef.current)
      return;

    const focusableElements =
      modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

    const firstElement =
      focusableElements[0];

    const lastElement =
      focusableElements[
        focusableElements.length - 1
      ];

    const handleKeyDown = (
      e: KeyboardEvent
    ) => {
      if (e.key === "Escape") {
        closeCardModal();

        return;
      }

      if (e.key === "Tab") {
        if (e.shiftKey) {
          if (
            document.activeElement ===
            firstElement
          ) {
            lastElement.focus();

            e.preventDefault();
          }
        } else {
          if (
            document.activeElement ===
            lastElement
          ) {
            firstElement.focus();

            e.preventDefault();
          }
        }
      }
    };

    document.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [activeCardId, closeCardModal]);

  // ========================================================================
  // Empty State
  // ========================================================================

  if (!activeCardId || title == null) {
    return null;
  }

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={closeCardModal}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative bg-white w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex justify-between items-start p-4 border-b">
          <div className="w-full pr-8">
            <TitleEditor
              cardId={activeCardId}
              initialTitle={title}
            />

            <p className="text-sm text-gray-500">
              in list{" "}
              <span className="underline font-medium">
                {listTitle}
              </span>
            </p>
          </div>

          <button
            onClick={closeCardModal}
            aria-label="Close modal"
            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto">
          <DescriptionEditor
            cardId={activeCardId}
            initialDesc={description || ""}
          />
        </div>
      </div>
    </div>
  );
}