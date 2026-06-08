"use client";

// AddLinkForm — inline form for adding an external link attachment.

import { useState }             from "react";
import { Plus, X }              from "lucide-react";
import { useAddLinkAttachment } from "../../../store/mutations/attachments/useAddLinkAttachment";
import { toast }                from "sonner";

interface Props { cardId: string; boardId: string; }

export function AddLinkForm({ cardId, boardId }: Props) {
  const [open,  setOpen]  = useState(false);
  const [url,   setUrl]   = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addLink = useAddLinkAttachment();

  function validate(value: string): string | null {
    try { new URL(value); return null; }
    catch { return "آدرس URL معتبر نیست."; }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(url.trim());
    if (err) { setError(err); return; }
    addLink.mutate(
      { cardId, boardId, url: url.trim(), title: title.trim() || undefined },
      {
        onSuccess: () => { setUrl(""); setTitle(""); setOpen(false); },
        onError:   (e: any) => toast.error(e?.message ?? "افزودن لینک با خطا مواجه شد."),
      },
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-600 py-2 text-xs text-slate-400 hover:border-slate-500 hover:bg-slate-700/30 hover:text-slate-300"
        dir="rtl"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        افزودن لینک
      </button>
    );
  }

  return (
    <form dir="rtl" onSubmit={handleSubmit} className="mb-3 rounded-lg border border-slate-600 bg-slate-800 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-400">افزودن لینک</p>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} aria-label="بستن" className="text-slate-500 hover:text-slate-300">
          <X className="h-4 w-4" />
        </button>
      </div>

      <input
        type="url"
        dir="ltr"
        value={url}
        onChange={(e) => { setUrl(e.target.value); if (error) setError(null); }}
        placeholder="https://..."
        aria-label="آدرس لینک"
        autoFocus
        className={`w-full rounded-md border px-3 py-1.5 text-sm bg-slate-700 text-slate-200 placeholder:text-slate-500 outline-none focus:ring-2 ${
          error ? "border-red-500 focus:ring-red-500/30" : "border-slate-600 focus:border-blue-500 focus:ring-blue-500/30"
        }`}
      />
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}

      <input
        type="text"
        dir="auto"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="عنوان (اختیاری)"
        aria-label="عنوان لینک"
        className="w-full rounded-md border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
      />

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!url.trim() || addLink.isPending}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {addLink.isPending ? "در حال افزودن..." : "افزودن"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="rounded-md px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200"
        >
          انصراف
        </button>
      </div>
    </form>
  );
}
