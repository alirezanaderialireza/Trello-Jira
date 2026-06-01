"use client";

// apps/web/src/components/checklists/ChecklistSection.tsx
//
// Composer for ONE checklist on a card. Stitches together:
//   • ChecklistHeader (drag handle + title + progress + actions menu)
//   • ChecklistItemRow × N (sortable items via @dnd-kit/sortable)
//   • InlineAddItemForm (bottom CTA)
//   • DeleteChecklistDialog (mounted but hidden until requested)
//
// State boundaries
//   This component is presentational. It accepts the live data
//   (checklist + items) and a callbacks bag that wraps the parent's
//   mutation hooks. It does NOT call useBoardStore or any tRPC.
//
// Item drag-and-drop (D3, D4)
//   The component owns its own DndContext + SortableContext keyed
//   by item.id, so items reorder WITHIN this checklist only — never
//   between checklists in the same card (D4 explicit). The parent
//   wraps all sections with the OUTER DndContext that handles
//   cross-section reorder of headers (D5 — Master Contract checklist
//   reorder).
//
// LexoRank position generation
//   On dragEnd we compute the new position via @repo/domain/ordering
//   `generatePosition(prev, next)` and call the parent's
//   `onUpdateItemPosition(itemId, newPosition)`. The parent's
//   useUpdateChecklistItem hook accepts `position` per F1.2.3.a.
//
// canEdit gating
//   Member tier (canEdit=true) sees the full UX. Viewer (canEdit=false)
//   sees a read-only checklist: no drag handles, no add form, no
//   delete menu, but checkboxes are still rendered as disabled to
//   communicate "the data exists, you just cannot toggle it".

import { useMemo, useState } from "react";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { generatePosition as getNewPosition } from "@repo/domain/ordering";

import type {
  ChecklistDto,
  ChecklistItemDto,
} from "@/features/board/store/useBoardStore";
import { computeProgress } from "@/lib/checklists/computeProgress";

import { ChecklistHeader }      from "./ChecklistHeader";
import { ChecklistItemRow }     from "./ChecklistItemRow";
import { InlineAddItemForm }    from "./InlineAddItemForm";
import { DeleteChecklistDialog } from "./DeleteChecklistDialog";

interface Props {
  checklist: ChecklistDto;
  /** Drag wiring from the OUTER DndContext (cross-section reorder). */
  outerDragAttributes?: Record<string, unknown>;
  outerDragListeners?:  Record<string, unknown>;
  outerSetNodeRef?:     (node: HTMLElement | null) => void;
  outerStyle?:          React.CSSProperties;
  isHeaderDragging?:    boolean;
  /** Whether the viewer can mutate the checklist (member ✓; viewer ✗). */
  canEdit: boolean;
  /** In-flight + error props from the parent's mutation hooks. */
  isAddingItem?:    boolean;
  addItemError?:    string | null;
  isUpdatingTitle?: boolean;
  isDeleting?:      boolean;
  deleteError?:     string | null;
  /** Mutation callbacks (parent wires the hooks). */
  onUpdateTitle:        (title: string) => void;
  onAddItem:            (text: string) => void;
  onToggleItemDone:     (itemId: string, isDone: boolean) => void;
  onUpdateItemText:     (itemId: string, text: string) => void;
  onUpdateItemPosition: (itemId: string, position: string) => void;
  onRemoveItem:         (itemId: string) => void;
  onDeleteChecklist:    () => void;
}

export function ChecklistSection(props: Props) {
  const {
    checklist,
    outerDragAttributes,
    outerDragListeners,
    outerSetNodeRef,
    outerStyle,
    isHeaderDragging = false,
    canEdit,
    isAddingItem = false,
    addItemError = null,
    isUpdatingTitle = false,
    isDeleting = false,
    deleteError = null,
    onUpdateTitle,
    onAddItem,
    onToggleItemDone,
    onUpdateItemText,
    onUpdateItemPosition,
    onRemoveItem,
    onDeleteChecklist,
  } = props;

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const progress = useMemo(
    () => computeProgress(checklist.items),
    [checklist.items],
  );

  // Inner DndContext for items.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemIds = useMemo(
    () => checklist.items.map((i) => i.id),
    [checklist.items],
  );

  function handleItemDragEnd(event: DragEndEvent) {
    if (!canEdit) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = checklist.items.findIndex((i) => i.id === active.id);
    const newIndex = checklist.items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    // Project the post-drop order to read prev/next neighbours; the
    // parent's optimistic mutation hook applies the actual store
    // change.
    const reordered = arrayMove([...checklist.items], oldIndex, newIndex);
    const idx       = reordered.findIndex((i) => i.id === active.id);
    const prev      = reordered[idx - 1]?.position;
    const next      = reordered[idx + 1]?.position;
    const newPos    = getNewPosition(prev, next);

    onUpdateItemPosition(active.id as string, newPos);
  }

  const isEmpty = checklist.items.length === 0;

  return (
    <section
      ref={outerSetNodeRef}
      style={outerStyle}
      className={`space-y-3 rounded-lg border bg-white p-3 transition-shadow ${
        isHeaderDragging
          ? "border-blue-400 shadow-lg ring-2 ring-blue-200"
          : "border-slate-200"
      }`}
      aria-label={`چک‌لیست ${checklist.title}`}
    >
      {/* Header */}
      <ChecklistHeader
        title={checklist.title}
        progress={progress}
        canEdit={canEdit}
        dragAttributes={outerDragAttributes}
        dragListeners={outerDragListeners}
        isDragging={isHeaderDragging}
        isDragDisabled={isUpdatingTitle}
        onUpdateTitle={onUpdateTitle}
        onRequestDelete={() => setShowDeleteDialog(true)}
      />

      {/* Items list with inner DndContext */}
      {checklist.items.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleItemDragEnd}
        >
          <SortableContext
            items={itemIds}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-0.5">
              {checklist.items.map((item: ChecklistItemDto) => (
                <ChecklistItemRow
                  key={item.id}
                  item={item}
                  canEdit={canEdit}
                  onToggleDone={onToggleItemDone}
                  onUpdateText={onUpdateItemText}
                  onDelete={onRemoveItem}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        // Empty state (D16) — auto-open the add form.
        <p className="px-2 py-1 text-xs text-slate-500">
          هنوز موردی اضافه نشده.
        </p>
      )}

      {/* Add-item form — auto-open on empty checklist (D16) */}
      <InlineAddItemForm
        canEdit={canEdit}
        onSubmit={onAddItem}
        isSubmitting={isAddingItem}
        errorMessage={addItemError}
        autoOpen={isEmpty && canEdit}
      />

      {/* Delete dialog */}
      <DeleteChecklistDialog
        open={showDeleteDialog}
        title={checklist.title}
        affectedItemCount={checklist.items.length}
        isSubmitting={isDeleting}
        errorMessage={deleteError}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => {
          setShowDeleteDialog(false);
          onDeleteChecklist();
        }}
      />
    </section>
  );
}
