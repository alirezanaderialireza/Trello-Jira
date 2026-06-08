"use client";

// apps/web/src/features/board/components/card-detail/CardAssignees.tsx
//
// Container for assignees in the card-detail modal.
//
// Responsibilities:
//   • Fetches assignees via trpc + hydrates store at mount.
//   • Reads card.assignees[] from store (userId[]).
//   • Resolves display info from state.boardMembers cache.
//   • Opens AssigneePicker on «+ افزودن مسئول» or keyboard «A».
//   • Inline X button on each assignee row.
//   • Role gate: locked card + MEMBER → no add/remove UI.

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useSession } from "next-auth/react";

import { trpc }                  from "../../../../utils/trpc";
import { useBoardStore }         from "../../store/useBoardStore";
import { useAddCardAssignee }    from "../../store/mutations/cards/useAddCardAssignee";
import { useRemoveCardAssignee } from "../../store/mutations/cards/useRemoveCardAssignee";
import { UserAvatar }            from "@/components/users/UserAvatar";
import { AssigneePicker }        from "@/features/assignees/components/AssigneePicker";

interface Props {
  cardId:  string;
  boardId: string;
  role?:   string;
}

export function CardAssignees({ cardId, boardId, role = "MEMBER" }: Props) {
  const [isPickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? "";

  // ── Fetch assignees and hydrate store ─────────────────────────────────────
  const applyEvent    = useBoardStore((s) => s.applyEvent);
  const boardMembers  = useBoardStore((s) => s.boardMembers);

  const assigneesQuery = (trpc as any).v1.public.cardAssignee.list.useQuery(
    { boardId, cardId },
    { staleTime: 30_000 },
  );

  // Hydrate store: set card.assignees[] from the server list.
  useEffect(() => {
    if (!assigneesQuery.isSuccess) return;
    const assignees = (assigneesQuery.data ?? []) as Array<{ userId: string }>;
    const assigneeIds = assignees.map((a: any) => a.userId);

    // We don't have a dedicated "set assignees" action, so we patch the card
    // directly by dispatching a synthetic card.updated event that only sets
    // the assignees array. The store's applyCardUpdated reducer merges changes.
    // This keeps the reducer chain intact for real-time updates.
    const card = useBoardStore.getState().cards[cardId];
    if (!card) return;
    applyEvent(
      {
        event: {
          id:            `hydrate-assignees-${cardId}`,
          type:          "card.updated",
          version:       card.revision,
          occurredAt:    new Date().toISOString(),
          aggregateId:   cardId,
          aggregateType: "card",
          payload:       { cardId, boardId, changes: { assignees: assigneeIds } },
        },
        optimistic: false,
      } as any,
      { mode: "live" },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assigneesQuery.dataUpdatedAt]);

  // ── Read from store ───────────────────────────────────────────────────────
  const assigneeIds = useBoardStore(
    useMemo(() => (s: any) => (s.cards[cardId]?.assignees ?? []) as string[], [cardId]),
  ) as string[];

  const isLocked = useBoardStore(
    useMemo(() => (s: any) => s.cards[cardId]?.locked ?? false, [cardId]),
  ) as boolean;

  const canManage =
    !isLocked || role === "ADMIN" || role === "OWNER";

  const assigneeIdSet = useMemo(() => new Set(assigneeIds), [assigneeIds]);

  // ── Remove handler ───────────────────────────────────────────────────────
  const removeAssignee = useRemoveCardAssignee();

  function handleRemove(userId: string) {
    removeAssignee.mutate({
      cardId,
      boardId,
      assigneeId:    userId,
      actorId:       currentUserId,
      correlationId: crypto.randomUUID(),
    });
  }

  // ── Keyboard shortcut «A» ────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      if ((e.key === "a" || e.key === "A") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setPickerOpen((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div dir="rtl">
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">مسئولان</h3>

      {/* Assignee list */}
      {assigneeIds.length > 0 ? (
        <div className="mb-2 space-y-1.5">
          {assigneeIds.map((userId) => {
            const member = boardMembers[userId];
            return (
              <div
                key={userId}
                className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-700/40"
              >
                <UserAvatar
                  displayName={member?.displayName}
                  avatarUrl={member?.avatarUrl}
                  size="xs"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-200 truncate">
                    {member?.displayName ?? `کاربر ${userId.slice(0, 8)}`}
                  </p>
                  {member?.email ? (
                    <p className="text-[11px] text-slate-500 truncate">{member.email}</p>
                  ) : null}
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleRemove(userId)}
                    aria-label={`حذف مسئول ${member?.displayName ?? userId}`}
                    disabled={removeAssignee.isPending}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-slate-500 hover:bg-red-900/30 hover:text-red-400 disabled:cursor-not-allowed"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mb-2 text-xs text-slate-500">هنوز کسی به این کارت اضافه نشده.</p>
      )}

      {/* Add trigger + picker */}
      {canManage && (
        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setPickerOpen((p) => !p)}
            aria-haspopup="dialog"
            aria-expanded={isPickerOpen}
            aria-label="افزودن مسئول (کلید A)"
            title="افزودن مسئول (کلید A)"
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-500 px-3 py-1 text-xs font-medium text-slate-300 hover:border-slate-400 hover:bg-slate-700/50 hover:text-slate-100"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>افزودن مسئول</span>
          </button>

          {isPickerOpen && (
            <div className="absolute top-full start-0 z-30 mt-2">
              <AssigneePicker
                cardId={cardId}
                boardId={boardId}
                currentUserId={currentUserId}
                currentAssigneeIds={assigneeIdSet}
                boardMembers={boardMembers}
                role={role}
                isCardLocked={isLocked}
                onClose={() => {
                  setPickerOpen(false);
                  triggerRef.current?.focus();
                }}
                triggerRef={triggerRef}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
