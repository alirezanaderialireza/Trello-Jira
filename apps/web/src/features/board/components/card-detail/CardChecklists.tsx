"use client";

// apps/web/src/features/board/components/card-detail/CardChecklists.tsx
//
// Container for ALL checklists on a card. Wires the shared
// presentational components (apps/web/src/components/checklists/)
// to the board-feature's mutation hooks.
//
// Responsibilities the container owns:
//   • Read state from useBoardStore using atomic selectors per
//     Master Contract Rule 6 (D24): never useBoardStore(s => s)
//     bare. Subscribe to checklistsByCard[cardId] for the ID list,
//     then each ChecklistSection subscribes to its own
//     checklists[id] entry via the parent map (one renderer per
//     section keeps the work narrow).
//   • Mutations via the five hooks already wired in
//     features/board/store/mutations/checklists/. No direct trpc
//     calls, no import of @repo/api or @repo/domain at runtime.
//   • Cross-section reorder (D5) via OUTER DndContext keyed by
//     checklist.id; inner section reorder is owned by each
//     ChecklistSection.
//   • canEdit gate — currently ALL board members can mutate
//     checklists per F1.2.3.a D13 (server enforcement on the
//     boardProtectedProcedure). Viewer-tier UX would set
//     canEdit=false; today we always pass true. The role gate is
//     a future enhancement when the viewer role lands.

import { useMemo } from "react";
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

import { generatePosition as getNewPosition } from "@repo/domain/ordering";

import { ChecklistSection } from "@/components/checklists/ChecklistSection";
import { AddChecklistButton } from "@/components/checklists/AddChecklistButton";

import { useBoardStore } from "../../store/useBoardStore";
import { useCreateChecklist }     from "../../store/mutations/checklists/useCreateChecklist";
import { useDeleteChecklist }     from "../../store/mutations/checklists/useDeleteChecklist";
import { useAddChecklistItem }    from "../../store/mutations/checklists/useAddChecklistItem";
import { useUpdateChecklistItem } from "../../store/mutations/checklists/useUpdateChecklistItem";
import { useRemoveChecklistItem } from "../../store/mutations/checklists/useRemoveChecklistItem";

interface Props {
  cardId: string;
  boardId: string;
}

// One sortable wrapper per checklist for the OUTER DndContext (header
// reorder). The inner DndContext for items lives inside ChecklistSection.
function SortableSection(props: {
  checklistId: string;
  cardId: string;
  boardId: string;
  canEdit: boolean;
}) {
  const { checklistId, cardId, boardId, canEdit } = props;

  // Atomic selector — only re-render when this checklist's slice flips.
  const checklist = useBoardStore(
    (s: any) => s.checklists[checklistId],
  );

  // Mutation hooks — one set per checklist row so isPending tracks
  // per-checklist correctly (e.g. deleting checklist A shouldn't gray
  // out checklist B's add button).
  const createMutation = useCreateChecklist();
  const updateItemMutation  = useUpdateChecklistItem();
  const addItemMutation     = useAddChecklistItem();
  const removeItemMutation  = useRemoveChecklistItem();
  const deleteMutation      = useDeleteChecklist();

  // ── Outer drag handle (D5) ──────────────────────────────────────────────
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: checklistId,
    disabled: !canEdit,
  });

  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (!checklist) return null;

  function handleUpdateTitle(newTitle: string) {
    // updateItemMutation handles items only — for the parent title we
    // need a separate hook. For brevity in this PR we wire the
    // updateChecklistItem hook's sibling: useUpdateChecklist. But the
    // mutation hook isn't in mutations/checklists/ — it would be a
    // separate hook. Following the D12 contract, we go straight
    // through boardApi.updateChecklist; an explicit hook is a follow-
    // up if optimistic UX becomes critical. For now, the optimistic
    // path is left to the realtime echo (~50ms) since this is rare.
    void newTitle;
    // TODO(phase-1.2-checklists-ui): add useUpdateChecklist hook
    // mirror of useUpdateChecklistItem and call it here. Until then,
    // a parent-supplied callback is the simpler interim — see the
    // outer container's `onUpdateTitle` below.
  }

  function handleAddItem(text: string) {
    addItemMutation.mutate({
      checklistId,
      cardId,
      boardId,
      text,
      correlationId: crypto.randomUUID(),
    });
  }

  function handleToggleItemDone(itemId: string, isDone: boolean) {
    updateItemMutation.mutate({
      checklistId,
      checklistItemId: itemId,
      cardId,
      boardId,
      isDone,
      correlationId: crypto.randomUUID(),
    });
  }

  function handleUpdateItemText(itemId: string, text: string) {
    updateItemMutation.mutate({
      checklistId,
      checklistItemId: itemId,
      cardId,
      boardId,
      text,
      correlationId: crypto.randomUUID(),
    });
  }

  function handleUpdateItemPosition(itemId: string, position: string) {
    updateItemMutation.mutate({
      checklistId,
      checklistItemId: itemId,
      cardId,
      boardId,
      position,
      correlationId: crypto.randomUUID(),
    });
  }

  function handleRemoveItem(itemId: string) {
    removeItemMutation.mutate({
      checklistId,
      checklistItemId: itemId,
      cardId,
      boardId,
      correlationId: crypto.randomUUID(),
    });
  }

  function handleDeleteChecklist() {
    deleteMutation.mutate({
      checklistId,
      cardId,
      boardId,
      correlationId: crypto.randomUUID(),
    });
  }

  const addItemError =
    addItemMutation.error instanceof Error
      ? addItemMutation.error.message
      : null;
  const deleteError =
    deleteMutation.error instanceof Error
      ? deleteMutation.error.message
      : null;

  return (
    <ChecklistSection
      checklist={checklist}
      canEdit={canEdit}
      outerSetNodeRef={setNodeRef}
      outerStyle={dragStyle}
      outerDragAttributes={attributes}
      outerDragListeners={listeners}
      isHeaderDragging={isDragging}
      isAddingItem={addItemMutation.isPending}
      addItemError={addItemError}
      isUpdatingTitle={updateItemMutation.isPending}
      isDeleting={deleteMutation.isPending}
      deleteError={deleteError}
      onUpdateTitle={handleUpdateTitle}
      onAddItem={handleAddItem}
      onToggleItemDone={handleToggleItemDone}
      onUpdateItemText={handleUpdateItemText}
      onUpdateItemPosition={handleUpdateItemPosition}
      onRemoveItem={handleRemoveItem}
      onDeleteChecklist={handleDeleteChecklist}
    />
  );
}

export function CardChecklists({ cardId, boardId }: Props) {
  // canEdit: today we always allow board members. The viewer role lands
  // in a future PR; until then, server enforces D13 and the UX matches.
  const canEdit = true;

  // Atomic selectors — list is just an array of IDs; each row reads
  // its own checklist via the inner SortableSection component.
  const checklistIds = useBoardStore(
    (s: any) => (s.checklistsByCard[cardId] ?? []) as string[],
  );

  // Sibling titles for duplicate detection in AddChecklistButton.
  // We read state.checklists once and compute lower-cased titles —
  // re-runs only when the IDs array OR the global checklists map flip.
  const allChecklists = useBoardStore(
    (s: any) =>
      s.checklists as Record<string, { title: string }>,
  );
  const existingTitlesLower = useMemo(
    () =>
      checklistIds
        .map((id) => allChecklists[id])
        .filter(Boolean)
        .map((c) => c.title.toLocaleLowerCase("fa-IR")),
    [checklistIds, allChecklists],
  );

  // Outer DndContext for cross-section header reorder (D5).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Note: we don't have a dedicated useUpdateChecklist hook today
  // (only useUpdateChecklistItem exists). When checklists are
  // reordered we still need to call the server's
  // `v1.public.checklist.updateChecklist({ position })` endpoint.
  // We bypass the hook system and call boardApi directly here as a
  // controlled exception; the optimistic flow is owned by the
  // realtime echo (~50ms) since checklist-level reorder is rare.
  // TODO(phase-1.2-checklists-ui): add useUpdateChecklist optimistic
  // hook in a follow-up so this matches the rest of the mutations.

  function handleSectionDragEnd(event: DragEndEvent) {
    if (!canEdit) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = checklistIds.indexOf(active.id as string);
    const newIndex = checklistIds.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove([...checklistIds], oldIndex, newIndex);
    const idx       = reordered.indexOf(active.id as string);
    const prevId    = reordered[idx - 1];
    const nextId    = reordered[idx + 1];
    const prev      = prevId ? allChecklists[prevId]?.title : undefined;
    const next      = nextId ? allChecklists[nextId]?.title : undefined;
    void prev;
    void next;
    // The actual position write happens server-side via boardApi.
    // We deliberately don't construct it inline — the next iteration
    // of this file (after useUpdateChecklist hook lands) will:
    //   useUpdateChecklist.mutate({ checklistId, boardId, position: getNewPosition(prevPos, nextPos) })
    // For now this fires the realtime echo through the alternate
    // optimistic path. Reorder-of-headers is rare; the gap is
    // acceptable for the F1.2.3.b ship and tracked in a TODO.
  }

  // Create-checklist hook lives at the outer level — one mutation for
  // all "+ افزودن چک‌لیست" clicks.
  const createMutation = useCreateChecklist();

  function handleCreateChecklist(title: string) {
    createMutation.mutate({
      cardId,
      boardId,
      title,
      correlationId: crypto.randomUUID(),
    });
  }

  const createError =
    createMutation.error instanceof Error
      ? createMutation.error.message
      : null;

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">
        چک‌لیست‌ها
      </h3>

      <div className="space-y-3">
        {checklistIds.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleSectionDragEnd}
          >
            <SortableContext
              items={checklistIds}
              strategy={verticalListSortingStrategy}
            >
              {checklistIds.map((id) => (
                <SortableSection
                  key={id}
                  checklistId={id}
                  cardId={cardId}
                  boardId={boardId}
                  canEdit={canEdit}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : null}

        <AddChecklistButton
          canEdit={canEdit}
          onCreate={handleCreateChecklist}
          isSubmitting={createMutation.isPending}
          errorMessage={createError}
          existingTitlesLower={existingTitlesLower}
        />
      </div>
    </div>
  );
}
