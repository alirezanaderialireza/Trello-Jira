"use client";

// apps/web/src/features/board/components/card-detail/comments/CommentEditForm.tsx
//
// Inline edit form for an existing comment. Shown inside CommentItem
// when the author clicks «ویرایش».
//
// UX contract:
//   • textarea pre-filled with comment.body; autoFocus on mount.
//   • Auto-resize height via onInput.
//   • Live counter: «N/۵۰۰۰» — amber when > 80%, red when at max.
//   • Cmd/Ctrl+Enter → save; Esc → cancel.
//   • No-op if trimmed body === original body (silent cancel).
//   • On error: toast shown by the hook; form stays open.

import { useEffect, useRef, useState } from "react";
import { useUpdateComment } from "../../../store/mutations/comments/useUpdateComment";

const MAX_LEN = 5_000;

interface Props {
  comment: {
    id:      string;
    cardId:  string;
    boardId: string;
    body:    string;
  };
  onCancel: () => void;
  onSaved:  () => void;
}

export function CommentEditForm({ comment, onCancel, onSaved }: Props) {
  const [body, setBody]   = useState(comment.body);
  const textareaRef       = useRef<HTMLTextAreaElement>(null);
  const updateComment     = useUpdateComment();

  // autoFocus + select-all on mount
  useEffect(() => {
    queueMicrotask(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.selectionStart = 0;
      el.selectionEnd   = el.value.length;
    });
  }, []);

  // auto-resize
  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => { autoResize(); }, [body]);

  const trimmed    = body.trim();
  const remaining  = MAX_LEN - body.length;
  const tooLong    = body.length > MAX_LEN;
  const isNoOp     = trimmed === comment.body.trim();
  const canSubmit  = trimmed.length > 0 && !tooLong && !updateComment.isPending;

  function handleSave() {
    if (isNoOp) { onCancel(); return; }
    if (!canSubmit) return;
    updateComment.mutate(
      {
        commentId:     comment.id,
        cardId:        comment.cardId,
        boardId:       comment.boardId,
        body:          trimmed,
        correlationId: crypto.randomUUID(),
      },
      { onSuccess: onSaved },
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
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
        onChange={(e) => { setBody(e.target.value); autoResize(); }}
        onKeyDown={handleKeyDown}
        disabled={updateComment.isPending}
        rows={3}
        maxLength={MAX_LEN + 1}  // +1 so TS sees the over-limit value
        aria-label="ویرایش متن کامنت"
        className={`w-full resize-none overflow-hidden rounded-lg border px-3 py-2 text-sm text-slate-100 bg-slate-700 outline-none transition-colors focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
          tooLong
            ? "border-red-500 focus:ring-red-500/30"
            : "border-slate-600 focus:border-blue-500 focus:ring-blue-500/30"
        }`}
      />

      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] tabular-nums ${counterClass}`}>
          {body.length.toLocaleString("fa-IR")}/{MAX_LEN.toLocaleString("fa-IR")}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={updateComment.isPending}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:cursor-not-allowed"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSubmit || isNoOp}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {updateComment.isPending ? "در حال ذخیره..." : "ذخیره"}
          </button>
        </div>
      </div>
    </div>
  );
}
