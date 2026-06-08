"use client";

// apps/web/src/features/assignees/components/AssigneePicker.tsx
//
// Popover for toggling assignees on a card. Mirrors LabelPicker.
//
// UX contract (D3, D8):
//   • Lists all active board members.
//   • Caller's own entry pinned to top with badge «(شما)» when not
//     yet assigned.
//   • Search: fa-IR fold on displayName + email.
//   • Click row → toggle assign/unassign.
//   • Per-row loading spinner during in-flight mutation.
//   • Card locked + caller is MEMBER → rows disabled with explainer.
//   • Outside click + Esc → onClose.
//   • Keyboard: ↑↓ navigate, Enter toggle, Esc close.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";

import { UserAvatar }                from "@/components/users/UserAvatar";
import type { BoardMemberDto }       from "@/features/board/store/useBoardStore";
import { useAddCardAssignee }        from "@/features/board/store/mutations/cards/useAddCardAssignee";
import { useRemoveCardAssignee }     from "@/features/board/store/mutations/cards/useRemoveCardAssignee";

interface Props {
  cardId:              string;
  boardId:             string;
  currentUserId:       string;
  currentAssigneeIds:  ReadonlySet<string>;
  boardMembers:        Record<string, BoardMemberDto>;
  /** "OWNER" | "ADMIN" | "MEMBER" — for locked-card gate. */
  role:                string;
  isCardLocked:        boolean;
  onClose:             () => void;
  /** Ref to the trigger button — restored on close. */
  triggerRef?:         React.RefObject<HTMLButtonElement | null>;
}

export function AssigneePicker({
  cardId,
  boardId,
  currentUserId,
  currentAssigneeIds,
  boardMembers,
  role,
  isCardLocked,
  onClose,
  triggerRef,
}: Props) {
  const [query,        setQuery]        = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [pendingId,    setPendingId]    = useState<string | null>(null);

  const rootRef   = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const addAssignee    = useAddCardAssignee();
  const removeAssignee = useRemoveCardAssignee();

  const isLocked = isCardLocked && role === "MEMBER";

  // Focus search on mount.
  useEffect(() => { queueMicrotask(() => searchRef.current?.focus()); }, []);

  // Outside click + Esc.
  useEffect(() => {
    function onMouse(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    }
    window.addEventListener("mousedown", onMouse);
    window.addEventListener("keydown",   onKey);
    return () => {
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("keydown",   onKey);
    };
  }, [onClose]);

  // Build sorted member list: current user first, then alphabetical.
  const sortedMembers = useMemo(() => {
    const list = Object.values(boardMembers);
    return [...list].sort((a, b) => {
      if (a.userId === currentUserId) return -1;
      if (b.userId === currentUserId) return 1;
      return a.displayName.localeCompare(b.displayName, "fa");
    });
  }, [boardMembers, currentUserId]);

  // Apply search filter (fa-IR fold).
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("fa-IR");
    if (!q) return sortedMembers;
    return sortedMembers.filter((m) =>
      m.displayName.toLocaleLowerCase("fa-IR").includes(q) ||
      m.email.toLocaleLowerCase("fa-IR").includes(q),
    );
  }, [sortedMembers, query]);

  // Reset focus on filter change.
  useEffect(() => {
    if (focusedIndex >= filtered.length) setFocusedIndex(filtered.length - 1);
  }, [filtered.length, focusedIndex]);

  function handleListKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((p) => (p < 0 ? 0 : (p + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((p) => (p <= 0 ? filtered.length - 1 : p - 1));
    } else if (e.key === "Enter" && focusedIndex >= 0) {
      e.preventDefault();
      const member = filtered[focusedIndex];
      if (member) toggle(member.userId);
    }
  }

  function toggle(userId: string) {
    if (isLocked || pendingId) return;
    setPendingId(userId);
    const correlationId = crypto.randomUUID();

    if (currentAssigneeIds.has(userId)) {
      removeAssignee.mutate(
        { cardId, boardId, assigneeId: userId, actorId: currentUserId, correlationId },
        { onSettled: () => setPendingId(null) },
      );
    } else {
      addAssignee.mutate(
        { cardId, boardId, assigneeId: userId, actorId: currentUserId, correlationId },
        { onSettled: () => setPendingId(null) },
      );
    }
  }

  return (
    <div
      ref={rootRef}
      dir="rtl"
      role="dialog"
      aria-modal="false"
      aria-label="انتخاب مسئول"
      className="flex flex-col rounded-xl border border-slate-700 bg-slate-800 shadow-2xl w-[calc(100vw-2rem)] max-w-xs md:w-72"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-100">مسئولان</h3>
        <button
          type="button"
          onClick={() => { onClose(); triggerRef?.current?.focus(); }}
          aria-label="بستن"
          className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 pt-3 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            dir="auto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleListKey}
            placeholder="جستجو در اعضا..."
            aria-label="جستجو در اعضای برد"
            autoComplete="off"
            className="block w-full rounded-md border border-slate-600 bg-slate-700 ps-9 pe-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>
      </div>

      {/* Lock notice */}
      {isLocked && (
        <p className="mx-4 mb-1 rounded-md bg-amber-900/30 px-3 py-1.5 text-xs text-amber-400">
          کارت قفل است. فقط مدیر می‌تواند مسئول تغییر دهد.
        </p>
      )}

      {/* Member list */}
      <ul
        role="listbox"
        aria-label="فهرست اعضای برد"
        className="max-h-60 overflow-y-auto px-2 pb-3 space-y-0.5"
        onKeyDown={handleListKey}
      >
        {filtered.length === 0 ? (
          <li className="py-4 text-center text-sm text-slate-500">عضوی یافت نشد.</li>
        ) : (
          filtered.map((member, idx) => {
            const isAssigned = currentAssigneeIds.has(member.userId);
            const isFocused  = idx === focusedIndex;
            const isMe       = member.userId === currentUserId;
            const isPending  = pendingId === member.userId;

            return (
              <li key={member.userId} role="option" aria-selected={isAssigned}>
                <button
                  type="button"
                  onClick={() => toggle(member.userId)}
                  onFocus={() => setFocusedIndex(idx)}
                  disabled={isLocked || (!!pendingId && !isPending)}
                  tabIndex={isFocused ? 0 : -1}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 ${
                    isFocused ? "bg-slate-700" : "hover:bg-slate-700/60"
                  }`}
                >
                  <UserAvatar
                    displayName={member.displayName}
                    avatarUrl={member.avatarUrl}
                    size="xs"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-sm font-medium text-slate-200 truncate">
                        {member.displayName}
                      </span>
                      {isMe && (
                        <span className="flex-shrink-0 text-[10px] text-slate-500">(شما)</span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500 truncate">{member.email}</span>
                  </div>

                  {/* Status indicator */}
                  <span
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                      isAssigned
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-600 bg-transparent"
                    }`}
                    aria-hidden="true"
                  >
                    {isPending ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                    ) : isAssigned ? (
                      <Check className="h-3 w-3" />
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
