"use client";

// apps/web/src/features/board/components/card-detail/comments/CommentForm.tsx
//
// New-comment form, always visible at the bottom of CommentsList.
//
// UX:
//   • 1-row collapsed by default; expands on focus to 4 rows.
//   • Cmd/Ctrl+Enter → submit; Esc → blur (but don't clear yet).
//   • After successful submit: textarea cleared, focus retained so
//     the user can type multiple comments quickly (Trello pattern).
//   • Counter: shown when body.length > 0. Amber > 80%, red at max.
//   • Submit disabled when empty or over limit or in-flight.

import { useRef, useState } from "react";
import { useAddComment } from "../../../store/mutations/comments/useAddComment";

const MAX_LEN = 5_000;

interface Props {
  cardId:        string;
  boardId:       string;
  currentUserId: string;
}

export function CommentForm({ cardId, boardId, currentUserId }: Props) {
  const [body,     setBody]     = useState("");
  const [expanded, setExpanded] = useState(false);
  const textareaRef             = useRef<HTMLTextAreaElement>(null);
  const addComment              = useAddComment();

  const trimmed   = body.trim();
  const tooLong   = body.length > MAX_LEN;
  const canSubmit = trimmed.length > 0 && !tooLong && !addComment.isPending;
  const remaining = MAX_LEN - body.length;

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function handleSubmit() {
    if (!canSubmit) return;
    addComment.mutate(
      {
        cardId,
        boardId,
        authorId:      currentUserId,
        body:          trimmed,
        correlationId: crypto.randomUUID(),
      },
      {
        onSuccess: () => {
          setBody("");
          setExpanded(false);
          // Restore height after clearing
          if (textareaRef.current) textareaRef.current.style.height = "auto";
          // Re-focus so the user can type another comment
          queueMicrotask(() => textareaRef.current?.focus());
        },
      },
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.currentTarget.blur();
    }
  }

  const counterClass =
    tooLong
      ? "text-red-400"
      : remaining < MAX_LEN * 0.2
      ? "text-amber-400"
      : "text-slate-500";

  return (
    <div dir="rtl" className="space-y-2">
      <textarea
        ref={textareaRef}
        value={body}
        placeholder="کامنت بنویسید..."
        rows={expanded ? 4 : 1}
        maxLength={MAX_LEN + 1}
        disabled={addComment.isPending}
        aria-label="نوشتن کامنت جدید"
        onFocus={() => setExpanded(true)}
        onBlur={() => { if (!body.trim()) setExpanded(false); }}
        onChange={(e) => { setBody(e.target.value); autoResize(); }}
        onKeyDown={handleKeyDown}
        className={`w-full resize-none overflow-hidden rounded-lg border px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 bg-slate-700/60 outline-none transition-all focus:bg-slate-700 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
          tooLong
            ? "border-red-500 focus:ring-red-500/30"
            : "border-slate-600 focus:border-blue-500 focus:ring-blue-500/30"
        }`}
      />

      {expanded ? (
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[11px] tabular-nums ${counterClass}`}>
            {body.length > 0
              ? `${body.length.toLocaleString("fa-IR")}/${MAX_LEN.toLocaleString("fa-IR")}`
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-600 hidden sm:inline">
              Ctrl+Enter برای ارسال
            </span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {addComment.isPending ? "در حال ارسال..." : "ارسال"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
