"use client";

// apps/web/src/features/board/components/card-detail/checklists/ChecklistManager.tsx
//
// Lists all checklists for a card (sorted by position), supports drag-
// and-drop reorder, and provides a form to add new checklists.
//
// DnD: @dnd-kit/sortable for the checklist list (not items — items are
//      handled inside each ChecklistRow). On drop, the new position is
//      computed with generatePosition and sent via useUpdateChecklist.
//
// Add form: collapsed by default; clicking the CTA expands an inline
//           form. Validates title (1..100 chars, no duplicates with
//           fa-IR fold). After submit, form collapses.
//
// Empty state: shown when no checklists exist yet.

import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus } from "lucide-react";
import { generatePosition } from "@repo/domain/ordering";

import type { ChecklistDto } from "../../../store/useBoardStore";
import { useCreateChecklist }  from "../../../store/mutations/checklists/useCreateChecklist";
import { useDeleteChecklist }  from "../../../store/mutations/checklists/useDeleteChecklist";
import { useUpdateChecklist }  from "../../../store/mutations/checklists/useUpdateChecklist";
import { ChecklistRow }        from "./ChecklistRow";
import { DeleteChecklistDialog } from "./DeleteChecklistDialog";

interface Props {
  checklists: readonly ChecklistDto[];
  cardId:     string;
  boardId:    string;
  /** userId of the card viewer — used to show delete button for creator. */
  viewerId:   string;
  /** Board role of the viewer — "ADMIN" | "OWNER" also get delete button. */
  viewerRole: string;
}

export function ChecklistManager({
  checklists,
  cardId,
  boardId,
  viewerId,
  viewerRole,
}: Props) {
  const [showAddForm,       setShowAddForm]       = useState(false);
  const [newTitle,          setNewTitle]          = useState("");
  const [newTitleError,     setNewTitleError]     = useState<string | null>(null);
  const [pendingDeleteId,   setPendingDeleteId]   = useState<string | null>(null);

  const createChecklist = useCreateChecklist();
  const deleteChecklist = useDeleteChecklist();
  const updateChecklist = useUpdateChecklist();

  // ── DnD sensors ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sortedChecklists = [...checklists].sort((a, b) =>
    a.position.localeCompare(b.position),
  );
  const checklistIds = sortedChecklists.map((c) => c.id);

  // ── Reorder handler ──────────────────────────────────────────────────────
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIdx = sortedChecklists.findIndex((c) => c.id === active.id);
    const newIdx = sortedChecklists.findIndex((c) => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const reordered = arrayMove([...sortedChecklists], oldIdx, newIdx);
    const idx       = reordered.findIndex((c) => c.id === active.id);
    const prev      = reordered[idx - 1]?.position;
    const next      = reordered[idx + 1]?.position;
    const newPos    = generatePosition(prev, next);

    updateChecklist.mutate({
      checklistId:   active.id as string,
      cardId,
      boardId,
      position:      newPos,
      correlationId: crypto.randomUUID(),
    });
  }

  // ── Add checklist form ────────────────────────────────────────────────────

  function validateNewTitle(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed)             return "عنوان چک‌لیست الزامی است.";
    if (trimmed.length > 100) return "عنوان چک‌لیست نباید از ۱۰۰ نویسه بیشتر باشد.";
    const fold      = trimmed.toLocaleLowerCase("fa-IR");
    const duplicate = checklists.some(
      (c) => c.title.toLocaleLowerCase("fa-IR") === fold,
    );
    if (duplicate) return "این عنوان چک‌لیست قبلاً در این کارت وجود دارد.";
    return null;
  }

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateNewTitle(newTitle);
    if (err) { setNewTitleError(err); return; }

    createChecklist.mutate({
      cardId,
      boardId,
      title:         newTitle.trim(),
      correlationId: crypto.randomUUID(),
    });
    setNewTitle("");
    setNewTitleError(null);
    setShowAddForm(false);
  }

  function handleAddKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setNewTitle("");
      setNewTitleError(null);
      setShowAddForm(false);
    }
  }

  // ── Delete dialog helpers ─────────────────────────────────────────────────

  const pendingDeleteChecklist = pendingDeleteId
    ? checklists.find((c) => c.id === pendingDeleteId)
    : undefined;

  function handleConfirmDelete() {
    if (!pendingDeleteId) return;
    const cl = checklists.find((c) => c.id === pendingDeleteId);
    if (!cl) return;
    deleteChecklist.mutate({
      checklistId:   pendingDeleteId,
      cardId,
      boardId,
      correlationId: crypto.randomUUID(),
    });
    setPendingDeleteId(null);
  }

  // ── canDelete helper ─────────────────────────────────────────────────────
  // Server is authoritative; this mirrors the rule so the button is
  // only shown when the server will likely accept the call.
  function canDeleteChecklist(cl: ChecklistDto): boolean {
    if (viewerRole === "ADMIN" || viewerRole === "OWNER") return true;
    // ChecklistDto doesn't carry createdBy on the store DTO — only admins
    // and owners see the delete button by default. Creator-based gate
    // requires extending the DTO (future), so for now members can't delete.
    // This matches the conservative "server authoritative" guard stance.
    return false;
  }

  // ── Empty state ───────────────────────────────────────────────────────────

  if (checklists.length === 0 && !showAddForm) {
    return (
      <div dir="rtl">
        <EmptyState onAdd={() => setShowAddForm(true)} />
        {/* Always show add form if explicitly opened even with empty state */}
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <div dir="rtl" className="space-y-3">
      {/* Checklist list with DnD reorder */}
      {sortedChecklists.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={checklistIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {sortedChecklists.map((cl) => (
                <SortableChecklistWrapper key={cl.id} id={cl.id}>
                  <ChecklistRow
                    checklist={cl}
                    cardId={cardId}
                    boardId={boardId}
                    canDelete={canDeleteChecklist(cl)}
                    onRequestDelete={() => setPendingDeleteId(cl.id)}
                    otherTitles={checklists
                      .filter((c) => c.id !== cl.id)
                      .map((c) => c.title)}
                  />
                </SortableChecklistWrapper>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add checklist form */}
      {showAddForm ? (
        <form
          onSubmit={handleAddSubmit}
          className="rounded-lg border border-slate-600 bg-slate-800 p-3 space-y-2"
        >
          <label
            htmlFor="new-checklist-title"
            className="block text-xs font-medium text-slate-400"
          >
            عنوان چک‌لیست جدید
          </label>
          <input
            id="new-checklist-title"
            type="text"
            dir="auto"
            value={newTitle}
            onChange={(e) => { setNewTitle(e.target.value); if (newTitleError) setNewTitleError(null); }}
            onKeyDown={handleAddKeyDown}
            maxLength={100}
            placeholder="مثال: وظایف تست"
            aria-label="عنوان چک‌لیست جدید"
            autoFocus
            className={`w-full rounded border px-3 py-1.5 text-sm text-slate-200 bg-slate-700 outline-none focus:ring-2 ${
              newTitleError
                ? "border-red-500 focus:ring-red-500/30"
                : "border-slate-600 focus:border-blue-500 focus:ring-blue-500/30"
            }`}
          />
          {newTitleError ? (
            <p role="alert" className="text-xs text-red-400">{newTitleError}</p>
          ) : null}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={createChecklist.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createChecklist.isPending ? "در حال ثبت..." : "افزودن"}
            </button>
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setNewTitle(""); setNewTitleError(null); }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            >
              انصراف
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-600 px-3 py-2 text-xs font-medium text-slate-400 hover:border-slate-500 hover:bg-slate-700/40 hover:text-slate-200"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>افزودن چک‌لیست</span>
        </button>
      )}

      {/* Delete confirmation dialog */}
      <DeleteChecklistDialog
        open={pendingDeleteChecklist !== undefined}
        checklist={pendingDeleteChecklist ?? { id: "", title: "" }}
        affectedItemCount={pendingDeleteChecklist?.items.length ?? 0}
        isSubmitting={deleteChecklist.isPending}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sortable wrapper for each checklist row
// ─────────────────────────────────────────────────────────────────────────────

interface SortableChecklistWrapperProps {
  id:       string;
  children: React.ReactNode;
}

function SortableChecklistWrapper({ id, children }: SortableChecklistWrapperProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${isDragging ? "opacity-50 shadow-lg z-10" : ""}`}
    >
      {/* Drag handle in the top-right corner of each checklist */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="جابجایی چک‌لیست"
        title="جابجایی"
        className="absolute start-1 top-3 z-10 flex h-6 w-6 cursor-grab items-center justify-center rounded text-slate-600 hover:text-slate-400 active:cursor-grabbing opacity-0 hover:opacity-100 group-hover:opacity-100"
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      dir="rtl"
      className="rounded-lg border border-dashed border-slate-700 bg-slate-800/30 p-6 text-center"
    >
      <p className="text-sm text-slate-500">هنوز هیچ چک‌لیستی برای این کارت وجود ندارد.</p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        <span>ساخت اولین چک‌لیست</span>
      </button>
    </div>
  );
}
