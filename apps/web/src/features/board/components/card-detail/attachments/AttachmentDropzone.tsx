"use client";

// AttachmentDropzone — drag-and-drop / click-to-upload zone.

import { useRef, useState }    from "react";
import { Upload }               from "lucide-react";
import { toast }                from "sonner";
import { useUploadAttachment }  from "../../../store/mutations/attachments/useUploadAttachment";

const MAX_MB       = Number(process.env.NEXT_PUBLIC_MAX_ATTACHMENT_SIZE_MB ?? 25);
const MAX_SIZE_B   = MAX_MB * 1024 * 1024;
const MAX_TOTAL    = 10;

interface Props {
  cardId:   string;
  boardId:  string;
  disabled: boolean;
}

export function AttachmentDropzone({ cardId, boardId, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef                = useRef<HTMLInputElement>(null);
  const upload                  = useUploadAttachment();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_SIZE_B) {
        toast.error(`فایل «${file.name}» از حد مجاز (${MAX_MB} مگابایت) بزرگ‌تر است.`);
        continue;
      }
      await upload.mutateAsync({ cardId, boardId, file });
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!disabled) handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      dir="rtl"
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => { if (!disabled) inputRef.current?.click(); }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="آپلود پیوست"
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !disabled) inputRef.current?.click(); }}
      className={`mb-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors
        ${disabled
          ? "cursor-not-allowed border-slate-700 opacity-50"
          : dragging
          ? "border-blue-500 bg-blue-900/10"
          : "border-slate-600 hover:border-slate-500 hover:bg-slate-700/30"
        }`}
    >
      <Upload className="h-5 w-5 text-slate-400" aria-hidden="true" />
      <p className="text-xs text-slate-400">
        {disabled
          ? `حداکثر ${MAX_TOTAL.toLocaleString("fa-IR")} پیوست مجاز است`
          : "کلیک کن یا فایل را اینجا رها کن"}
      </p>
      {!disabled && (
        <p className="text-[10px] text-slate-600">
          حداکثر {MAX_MB.toLocaleString("fa-IR")} مگابایت
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
