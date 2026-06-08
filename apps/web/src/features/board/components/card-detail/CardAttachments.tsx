"use client";

// apps/web/src/features/board/components/card-detail/CardAttachments.tsx
//
// Container for the attachments section of a card-detail modal.
// Fetches list via tRPC, merges with real-time store entries, renders
// the dropzone, link form, and attachment list.

import { useCallback, useMemo } from "react";
import { useSession }           from "next-auth/react";

import { trpc }                 from "../../../../utils/trpc";
import { useBoardStore }        from "../../store/useBoardStore";
import type { AttachmentDto }   from "../../store/useBoardStore";
import { AttachmentDropzone }   from "./attachments/AttachmentDropzone";
import { AddLinkForm }          from "./attachments/AddLinkForm";
import { AttachmentItem }       from "./attachments/AttachmentItem";

const MAX_TOTAL = 10;

interface Props {
  cardId:  string;
  boardId: string;
  role?:   string;
}

const selectAttachmentsByCard =
  (cardId: string) => (s: any): AttachmentDto[] => {
    const ids: string[] = s.attachmentsByCard[cardId] ?? [];
    return ids.map((id: string) => s.attachments[id]).filter(Boolean);
  };

export function CardAttachments({ cardId, boardId, role = "MEMBER" }: Props) {
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? "";
  const canManage     = role === "ADMIN" || role === "OWNER";

  // ── Server query ──────────────────────────────────────────────────────────
  const { data, isLoading } = (trpc as any).v1.public.attachment.list.useQuery(
    { boardId, cardId },
    { staleTime: 30_000 },
  );
  const serverList: AttachmentDto[] = useMemo(
    () => (data?.attachments ?? []) as AttachmentDto[],
    [data],
  );

  // ── Real-time store ───────────────────────────────────────────────────────
  const storeList = useBoardStore(
    useCallback(selectAttachmentsByCard(cardId), [cardId]),
  ) as AttachmentDto[];

  // ── Merge (dedup by id, store wins for optimistic) ────────────────────────
  const merged: AttachmentDto[] = useMemo(() => {
    const serverIds = new Set(serverList.map((a) => a.id));
    const extra     = storeList.filter((a) => !serverIds.has(a.id));
    return [...extra, ...serverList];
  }, [serverList, storeList]);

  const atLimit = merged.length >= MAX_TOTAL;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div dir="rtl">
      <h3 className="mb-3 text-xs font-semibold uppercase text-slate-400">
        پیوست‌ها
        {merged.length > 0 && (
          <span className="ms-1.5 text-slate-600 normal-case">
            ({merged.length.toLocaleString("fa-IR")}/{MAX_TOTAL.toLocaleString("fa-IR")})
          </span>
        )}
      </h3>

      {/* Upload dropzone */}
      <AttachmentDropzone cardId={cardId} boardId={boardId} disabled={atLimit} />

      {/* Link form */}
      {!atLimit && <AddLinkForm cardId={cardId} boardId={boardId} />}

      {/* List */}
      {isLoading && merged.length === 0 ? (
        <div className="space-y-2 animate-pulse">
          {[1, 2].map((n) => (
            <div key={n} className="flex gap-3">
              <div className="h-9 w-12 flex-shrink-0 rounded bg-slate-700" />
              <div className="flex-1 space-y-1.5 pt-1">
                <div className="h-3 w-3/4 rounded bg-slate-700" />
                <div className="h-2.5 w-20 rounded bg-slate-700/60" />
              </div>
            </div>
          ))}
        </div>
      ) : merged.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">
          هنوز پیوستی اضافه نشده.
        </p>
      ) : (
        <div className="space-y-0.5">
          {merged.map((a) => (
            <AttachmentItem
              key={a.id}
              attachment={a}
              cardId={cardId}
              boardId={boardId}
              currentUserId={currentUserId}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
