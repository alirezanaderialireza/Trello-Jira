"use client";

// AttachmentItem — single attachment row (file or link).

import { useState }            from "react";
import {
  File, FileText, Image, Link, Music,
  Trash2, Video,
} from "lucide-react";

import type { AttachmentDto } from "../../../store/useBoardStore";
import { useRemoveAttachment } from "../../../store/mutations/attachments/useRemoveAttachment";
import { useSetCardCover }     from "../../../store/mutations/cards/useSetCardCover";
import { formatRelative }      from "@/lib/relativeTime";
import { formatFileSize }      from "@/lib/formatFileSize";

interface Props {
  attachment:    AttachmentDto;
  cardId:        string;
  boardId:       string;
  currentUserId: string;
  canManage:     boolean;
}

function FileIcon({ mimeType }: { mimeType: string | null }) {
  const mime = mimeType ?? "";
  if (mime.startsWith("image/")) return <Image className="h-5 w-5 text-blue-400" />;
  if (mime.startsWith("video/")) return <Video className="h-5 w-5 text-purple-400" />;
  if (mime.startsWith("audio/")) return <Music className="h-5 w-5 text-green-400" />;
  if (mime.includes("pdf"))       return <FileText className="h-5 w-5 text-red-400" />;
  if (mime.includes("spreadsheet") || mime.includes("excel"))
    return <FileText className="h-5 w-5 text-emerald-400" />;
  if (mime.includes("word") || mime.includes("document"))
    return <FileText className="h-5 w-5 text-blue-300" />;
  if (mime === "text/uri-list") return <Link className="h-5 w-5 text-slate-400" />;
  return <File className="h-5 w-5 text-slate-400" />;
}

export function AttachmentItem({ attachment, cardId, boardId, currentUserId, canManage }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const removeAttachment = useRemoveAttachment();
  const setCardCover     = useSetCardCover();

  const isImage = (attachment.mimeType ?? "").startsWith("image/");
  const isLink  = attachment.type === "link";
  const canDelete = canManage || attachment.uploadedBy === currentUserId;

  function handleRemove() {
    removeAttachment.mutate({
      attachmentId:  attachment.id,
      cardId,
      boardId,
      correlationId: crypto.randomUUID(),
    });
    setConfirmDelete(false);
  }

  return (
    <div dir="rtl" className="group flex gap-3 items-start rounded-lg p-2 hover:bg-slate-700/40">
      {/* Thumbnail or icon */}
      <div className="flex-shrink-0 mt-0.5">
        {isImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={attachment.url}
            alt={attachment.fileName}
            width={48}
            height={36}
            loading="lazy"
            className="h-9 w-12 rounded object-cover bg-slate-700"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="flex h-9 w-12 items-center justify-center rounded bg-slate-700">
            <FileIcon mimeType={attachment.mimeType} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-200">
          {attachment.title ?? attachment.fileName}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {isLink ? "لینک" : formatFileSize(attachment.sizeBytes)}
          {!isLink && attachment.sizeBytes ? " · " : ""}
          {formatRelative(attachment.createdAt)}
        </p>

        <div className="mt-1 flex items-center gap-3">
          <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:underline"
          >
            {isLink ? "باز کردن" : "دانلود"}
          </a>

          {/* Set as cover — only for image attachments (D6) */}
          {isImage && (
            <button
              type="button"
              onClick={() =>
                setCardCover.mutate({
                  cardId,
                  boardId,
                  coverData: { type: "image", id: attachment.id, url: attachment.url },
                  correlationId: crypto.randomUUID(),
                })
              }
              disabled={setCardCover.isPending}
              className="text-xs text-slate-400 hover:text-blue-400 disabled:cursor-not-allowed"
            >
              تنظیم به عنوان پوشش
            </button>
          )}

          {canDelete && !confirmDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={removeAttachment.isPending}
              aria-label={`حذف پیوست ${attachment.fileName}`}
              className="text-xs text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity disabled:cursor-not-allowed"
            >
              <Trash2 className="h-3 w-3 inline -mt-px" aria-hidden="true" /> حذف
            </button>
          )}

          {confirmDelete && (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-400">مطمئنی؟</span>
              <button
                type="button"
                onClick={handleRemove}
                disabled={removeAttachment.isPending}
                className="text-red-400 hover:underline disabled:cursor-not-allowed"
              >
                {removeAttachment.isPending ? "..." : "بله"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-slate-500 hover:underline"
              >
                نه
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
