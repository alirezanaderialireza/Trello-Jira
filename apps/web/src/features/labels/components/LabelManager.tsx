"use client";

// apps/web/src/features/labels/components/LabelManager.tsx
//
// The "labels" tab of the BoardSettingsDrawer (D1, D2). Lists every
// live board label, lets admins create / inline-edit / delete /
// reorder via drag-and-drop. Pure presentational — parent owns the
// data fetch, the mutation hooks, and the role gate decision.
//
// Drag-and-drop reorder (D6)
//   • @dnd-kit/sortable, vertical list strategy.
//   • On drop, compute the new LexoRank position from the items
//     immediately before and after the target slot in the
//     post-drop order, then call `onUpdate(labelId, { position })`.
//   • Position generation comes from `@repo/domain/ordering →
//     getNewPosition`, the project's runtime carveout for LexoRank
//     primitives. Architecture.md "Type-only carveout" explicitly
//     allows this subpath.
//
// Role gate (D8, server-mirror)
//   • `canManage = role === ADMIN || role === OWNER` — passed in by
//     the container. Members see a read-only list with no create /
//     edit / delete affordances. The drag handle is also disabled
//     so member-tier users can't trigger a position update that the
//     server would reject anyway.
//
// State ownership
//   • showCreateForm — whether the inline create form is expanded.
//   • editingLabelId — at most one row in edit mode at a time.
//   • pendingDeleteId — at most one delete dialog open at a time.
//   • All in-flight + error props (isCreating / isUpdating / …)
//     come from the parent's mutation hooks.

import { useEffect, useMemo, useState } from "react";
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
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";

import type { ColorToken } from "@repo/domain";
import { generatePosition as getNewPosition } from "@repo/domain/ordering";

import { LabelBadge } from "@/components/labels/LabelBadge";
import {
  CreateLabelForm,
  type CreateLabelFormSubmitValues,
} from "@/components/labels/CreateLabelForm";
import {
  EditLabelForm,
  type EditLabelFormSubmitValues,
} from "./EditLabelForm";
import { DeleteLabelDialog } from "./DeleteLabelDialog";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelManagerLabel {
  id:         string;
  name:       string;
  colorToken: string;
  position:   string;
}

export interface LabelManagerProps {
  /** Live labels for the board, already sorted ascending by position. */
  labels:             readonly LabelManagerLabel[];
  /** labelId → number of cards using the label (used by the delete dialog). */
  affectedCardCounts: Readonly<Record<string, number>>;
  /** Member-tier users see a read-only list. Admins/owners get the full UX. */
  canManage:          boolean;
  /** Per-mutation in-flight + error props from the parent's hooks. */
  isCreating?:  boolean;
  createError?: string | null;
  isUpdating?:  boolean;
  updateError?: string | null;
  isDeleting?:  boolean;
  deleteError?: string | null;
  /** Mutation callbacks. */
  onCreate:     (values: CreateLabelFormSubmitValues) => void;
  onUpdate:     (
    labelId: string,
    patch:   { name?: string; colorToken?: ColorToken; position?: string },
  ) => void;
  onDelete:     (labelId: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function LabelManager({
  labels,
  affectedCardCounts,
  canManage,
  isCreating = false,
  createError = null,
  isUpdating = false,
  updateError = null,
  isDeleting = false,
  deleteError = null,
  onCreate,
  onUpdate,
  onDelete,
}: LabelManagerProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // If the editing label disappears (e.g. someone else deletes it
  // mid-edit), close the row so the form doesn't render against
  // missing data.
  useEffect(() => {
    if (editingLabelId && !labels.some((l) => l.id === editingLabelId)) {
      setEditingLabelId(null);
    }
  }, [labels, editingLabelId]);

  // Same belt-and-braces for the pending delete: a parallel race
  // could remove the label before the dialog confirms.
  useEffect(() => {
    if (pendingDeleteId && !labels.some((l) => l.id === pendingDeleteId)) {
      setPendingDeleteId(null);
    }
  }, [labels, pendingDeleteId]);

  // Pointer sensor with an 8px activation distance prevents accidental
  // drags when the user just clicks the row body (e.g. to enter edit
  // mode). Keyboard sensor uses dnd-kit's standard keyboard coords
  // resolver for accessible reorder.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // SortableContext requires a stable list of ids per render.
  const labelIds = useMemo(() => labels.map((l) => l.id), [labels]);

  function handleDragEnd(event: DragEndEvent) {
    if (!canManage) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = labels.findIndex((l) => l.id === active.id);
    const newIndex = labels.findIndex((l) => l.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    // Compute the LexoRank position from the neighbours in the
    // post-drop order. arrayMove gives us the projected shape so we
    // can read prev/next without applying the change ourselves —
    // the optimistic mutation hook owns the actual store update.
    const reordered = arrayMove([...labels], oldIndex, newIndex);
    const idx       = reordered.findIndex((l) => l.id === active.id);
    const prev      = reordered[idx - 1]?.position;
    const next      = reordered[idx + 1]?.position;
    const newPos    = getNewPosition(prev, next);

    onUpdate(active.id as string, { position: newPos });
  }

  const pendingDeleteLabel = pendingDeleteId
    ? labels.find((l) => l.id === pendingDeleteId)
    : undefined;
  const pendingDeleteCount = pendingDeleteId
    ? affectedCardCounts[pendingDeleteId] ?? 0
    : 0;

  return (
    <div className="space-y-4">
      {/* Header — title + add CTA */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900">برچسب‌های برد</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {canManage
              ? "برچسب‌های قابل اعمال روی کارت‌های این برد را اینجا مدیریت کنید."
              : "فهرست برچسب‌های برد. برای ویرایش، نیاز به دسترسی مدیر دارید."}
          </p>
        </div>
        {canManage && !showCreateForm ? (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            disabled={isCreating}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>افزودن برچسب</span>
          </button>
        ) : null}
      </div>

      {/* Inline create form */}
      {canManage && showCreateForm ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <CreateLabelForm
            existingNames={labels.map((l) => l.name)}
            isSubmitting={isCreating}
            errorMessage={createError}
            onSubmit={(values) => {
              onCreate(values);
              setShowCreateForm(false);
            }}
            onCancel={() => setShowCreateForm(false)}
          />
        </div>
      ) : null}

      {/* List or empty state */}
      {labels.length === 0 ? (
        <EmptyState
          canManage={canManage}
          onCreate={() => setShowCreateForm(true)}
          isFormOpen={showCreateForm}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={labelIds} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1.5">
              {labels.map((label) => (
                <SortableLabelRow
                  key={label.id}
                  label={label}
                  isEditing={editingLabelId === label.id}
                  canManage={canManage}
                  isUpdating={isUpdating}
                  updateError={editingLabelId === label.id ? updateError : null}
                  existingNamesExcludingSelf={labels
                    .filter((l) => l.id !== label.id)
                    .map((l) => l.name)}
                  onStartEdit={() => {
                    setEditingLabelId(label.id);
                    setShowCreateForm(false);
                  }}
                  onCancelEdit={() => setEditingLabelId(null)}
                  onSubmitEdit={(values) => {
                    onUpdate(label.id, values);
                    setEditingLabelId(null);
                  }}
                  onRequestDelete={() => setPendingDeleteId(label.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {/* Delete confirm dialog */}
      <DeleteLabelDialog
        open={pendingDeleteLabel !== undefined}
        label={pendingDeleteLabel ?? { id: "", name: "" }}
        affectedCardCount={pendingDeleteCount}
        isSubmitting={isDeleting}
        errorMessage={deleteError}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (!pendingDeleteId) return;
          onDelete(pendingDeleteId);
          setPendingDeleteId(null);
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Single sortable row
// ─────────────────────────────────────────────────────────────────────────────

interface SortableLabelRowProps {
  label:                       LabelManagerLabel;
  isEditing:                   boolean;
  canManage:                   boolean;
  isUpdating:                  boolean;
  updateError:                 string | null;
  existingNamesExcludingSelf:  readonly string[];
  onStartEdit:                 () => void;
  onCancelEdit:                () => void;
  onSubmitEdit:                (values: EditLabelFormSubmitValues) => void;
  onRequestDelete:             () => void;
}

function SortableLabelRow({
  label,
  isEditing,
  canManage,
  isUpdating,
  updateError,
  existingNamesExcludingSelf,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRequestDelete,
}: SortableLabelRowProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id:       label.id,
    disabled: !canManage || isEditing, // no drag while editing
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border bg-white transition-shadow ${
        isDragging
          ? "border-blue-400 shadow-lg ring-2 ring-blue-200"
          : "border-slate-200 hover:border-slate-300"
      }`}
    >
      {isEditing ? (
        <div className="p-3">
          <EditLabelForm
            label={label}
            existingNames={existingNamesExcludingSelf}
            isSubmitting={isUpdating}
            errorMessage={updateError}
            onSubmit={onSubmitEdit}
            onCancel={onCancelEdit}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 px-2 py-2">
          {/* Drag handle */}
          {canManage ? (
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`جابجایی ${label.name}`}
              title="جابجایی"
              className="flex h-7 w-7 flex-shrink-0 cursor-grab items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            // Reserve the same horizontal space so badges line up
            // between manageable and read-only states.
            <div aria-hidden="true" className="h-7 w-7 flex-shrink-0" />
          )}

          {/* Badge — flex-1 so it fills the row width */}
          <div className="min-w-0 flex-1">
            <LabelBadge name={label.name} colorToken={label.colorToken} size="sm" />
          </div>

          {/* Action buttons */}
          {canManage ? (
            <div className="flex flex-shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onStartEdit}
                disabled={isUpdating}
                aria-label={`ویرایش ${label.name}`}
                title="ویرایش"
                className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onRequestDelete}
                disabled={isUpdating}
                aria-label={`حذف ${label.name}`}
                title="حذف"
                className="flex h-7 w-7 items-center justify-center rounded text-red-500 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      )}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state (D19)
// ─────────────────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  canManage:  boolean;
  isFormOpen: boolean;
  onCreate:   () => void;
}

function EmptyState({ canManage, isFormOpen, onCreate }: EmptyStateProps) {
  if (isFormOpen) {
    // While the create form is open, suppress the empty-state CTA so
    // we don't render two competing "create" buttons in the same view.
    return null;
  }
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <p className="text-sm text-slate-600">
        هنوز برچسبی برای این برد ساخته نشده.
      </p>
      {canManage ? (
        <button
          type="button"
          onClick={onCreate}
          className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>ساخت اولین برچسب</span>
        </button>
      ) : (
        <p className="mt-2 text-xs text-slate-500">
          برای ساخت برچسب، نیاز به دسترسی مدیر دارید.
        </p>
      )}
    </div>
  );
}
