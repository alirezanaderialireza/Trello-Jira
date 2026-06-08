"use client";

// apps/web/src/features/board/components/card-detail/comments/CommentItem.tsx
//
// Renders a single comment row:
//   UserAvatar | name + relative time | body + actions
//
// Author display name: the list API returns only `authorId` (UUID).
// We display a truncated UUID fragment as fallback until F1.2.x adds a
// list-with-authors procedure. When `displayName` prop is provided
// (future), it is used directly.
//
// Actions (visible on hover/focus, always visible on mobile):
//   «ویرایش» — only for comment author
//   «حذف»    — for author OR canManage (admin/owner)
//
// Soft-deleted comments: body replaced with italic placeholder.
// Optimistic in-flight: left border + slight opacity.

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import type { CommentDto } from "../../../store/useBoardStore";
import { UserAvatar }      from "@/components/users/UserAvatar";
import { formatRelative, formatAbsolute } from "@/lib/relativeTime";
import { CommentEditForm } from "./CommentEditForm";

interface Props {
  comment:    CommentDto;
  currentUserId: string;
  /** True when the viewer is board admin or owner. */
  canManage:  boolean;
  onDelete:   (comment: CommentDto) => void;
  /** Pre-resolved display name from a future list-with-authors procedure. */
  displayName?: string | null;
  avatarUrl?:   string | null;
}

export function CommentItem({
  comment,
  currentUserId,
  canManage,
  onDelete,
  displayName,
  avatarUrl,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);

  const isAuthor   = comment.authorId === currentUserId;
  const isDeleted  = !!(comment as any).deletedAt;
  const isOptimistic = comment.isOptimistic;

  // Fallback display name: first 8 chars of the authorId UUID
  const resolvedName = displayName ?? `کاربر ${comment.authorId.slice(0, 8)}`;

  return (
    <div
      dir="rtl"
      className={`group flex gap-2.5 ${isOptimistic ? "opacity-60" : ""}`}
    >
      {/* Avatar */}
      <div className="mt-0.5 flex-shrink-0">
        <UserAvatar
          displayName={resolvedName}
          avatarUrl={avatarUrl}
          size="sm"
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Header: name + timestamp */}
        <div className="mb-1 flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-200 truncate max-w-[12rem]">
            {resolvedName}
          </span>
          <span
            className="text-[11px] text-slate-500 flex-shrink-0"
            title={formatAbsolute(comment.createdAt)}
          >
            {formatRelative(comment.createdAt)}
          </span>
          {comment.editedAt ? (
            <span
              className="text-[10px] italic text-slate-600 flex-shrink-0"
              title={`ویرایش‌شده در ${formatAbsolute(comment.editedAt)}`}
            >
              (ویرایش‌شده)
            </span>
          ) : null}
          {isOptimistic ? (
            <span className="text-[10px] text-slate-600 flex-shrink-0">
              در حال ارسال...
            </span>
          ) : null}
        </div>

        {/* Body or edit form */}
        {isEditing ? (
          <CommentEditForm
            comment={comment}
            onCancel={() => setIsEditing(false)}
            onSaved={() => setIsEditing(false)}
          />
        ) : isDeleted ? (
          <p className="text-sm italic text-slate-600">
            این کامنت حذف شد.
          </p>
        ) : (
          <p className="text-sm text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
            {comment.body}
          </p>
        )}

        {/* Actions — hover on desktop, always visible on mobile */}
        {!isEditing && !isDeleted && !isOptimistic && (isAuthor || canManage) ? (
          <div
            className="mt-1.5 flex items-center gap-1
              opacity-0 group-hover:opacity-100 focus-within:opacity-100
              sm:opacity-0 max-sm:opacity-100
              transition-opacity"
          >
            {isAuthor ? (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                aria-label="ویرایش کامنت"
                title="ویرایش"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-700 hover:text-slate-300"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
                <span>ویرایش</span>
              </button>
            ) : null}

            {isAuthor || canManage ? (
              <button
                type="button"
                onClick={() => onDelete(comment)}
                aria-label="حذف کامنت"
                title="حذف"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-red-900/30 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                <span>حذف</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
