// apps/web/src/features/board/api/services/boardApi.ts

/**
 * 🚀 Board API Service (tRPC Bridge) — Phase 4 complete edition
 *
 * Single integration point between all mutation hooks and the tRPC backend.
 * If a tRPC route is renamed or restructured, only this file changes.
 *
 * Sections:
 *   1. Cards          (Phase 1-2, unchanged)
 *   2. Lists          (Phase 1-2, unchanged)
 *   3. Labels         (Phase 4)
 *   4. Checklists     (Phase 4)
 *   5. Comments       (Phase 4)
 *   6. Attachments    (Phase 4)
 *   7. Templates      (Phase 4)
 *   8. Card sub-ops   (Phase 4 — assignee, dueDate, lock/unlock)
 */

import { trpc } from "../../../../utils/trpc";
import type { TemplateStructure } from "@repo/domain";

// ============================================================================
// 1.  Cards
// ============================================================================

export const boardApi = {
  // ── create ────────────────────────────────────────────────────────────────
  createCard: async (payload: {
    listId: string;
    title: string;
    mutationId: string;
  }) => trpc.card.create.mutateAsync(payload),

  // ── move ──────────────────────────────────────────────────────────────────
  moveCard: async (payload: {
    cardId: string;
    targetListId: string;
    mode: "APPEND" | "PREPEND" | "INSERT_BETWEEN" | "REORDER_SAME_LIST";
    prevId?: string;
    nextId?: string;
    mutationId: string;
    expectedListRevisions?: Record<string, number>;
  }) => trpc.board.moveCard.mutateAsync(payload),

  // ── update ────────────────────────────────────────────────────────────────
  updateCard: async (payload: {
    id: string;
    title?: string;
    description?: string;
    expectedRevision?: number;
    mutationId: string;
  }) => trpc.card.update.mutateAsync(payload),

  // ── delete ────────────────────────────────────────────────────────────────
  deleteCard: async (payload: {
    id: string;
    mutationId: string;
  }) => trpc.card.delete.mutateAsync(payload),

  // ── lock / unlock ─────────────────────────────────────────────────────────
  lockCard: async (payload: {
    cardId: string;
    mutationId: string;
  }) => trpc.card.lock.mutateAsync(payload),

  unlockCard: async (payload: {
    cardId: string;
    mutationId: string;
  }) => trpc.card.unlock.mutateAsync(payload),

  // ── assignees ─────────────────────────────────────────────────────────────
  addCardAssignee: async (payload: {
    cardId: string;
    assigneeId: string;
    mutationId: string;
  }) => trpc.card.addAssignee.mutateAsync(payload),

  removeCardAssignee: async (payload: {
    cardId: string;
    assigneeId: string;
    mutationId: string;
  }) => trpc.card.removeAssignee.mutateAsync(payload),

  // ── due date ──────────────────────────────────────────────────────────────
  updateCardDueDate: async (payload: {
    cardId: string;
    dueDate: string | null;
    mutationId: string;
  }) => trpc.card.updateDueDate.mutateAsync(payload),

  // ============================================================================
  // 2.  Lists
  // ============================================================================

  createList: async (payload: {
    boardId: string;
    title: string;
    mutationId: string;
    expectedBoardRevision?: number;
    expectedAclVersion?: number;
  }) => trpc.list.create.mutateAsync(payload),

  moveList: async (payload: {
    boardId: string;
    listId: string;
    newPosition: string;
    mutationId: string;
  }) => trpc.board.moveList.mutate(payload),

  updateList: async (payload: {
    listId: string;
    title: string;
    mutationId: string;
  }) => (trpc.list as any).update.mutateAsync(payload),

  deleteList: async (payload: {
    listId: string;
    mutationId: string;
  }) => (trpc.list as any).delete.mutateAsync(payload),

  // ============================================================================
  // 3.  Labels
  // ============================================================================

  createLabel: async (payload: {
    boardId: string;
    name: string;
    color: string;
    mutationId: string;
  }) => (trpc as any).label.create.mutateAsync(payload),

  updateLabel: async (payload: {
    labelId: string;
    name?: string;
    color?: string;
    mutationId: string;
  }) => (trpc as any).label.update.mutateAsync(payload),

  deleteLabel: async (payload: {
    labelId: string;
    mutationId: string;
  }) => (trpc as any).label.delete.mutateAsync(payload),

  addCardLabel: async (payload: {
    cardId: string;
    labelId: string;
    mutationId: string;
  }) => (trpc as any).label.addToCard.mutateAsync(payload),

  removeCardLabel: async (payload: {
    cardId: string;
    labelId: string;
    mutationId: string;
  }) => (trpc as any).label.removeFromCard.mutateAsync(payload),

  // ============================================================================
  // 4.  Checklists
  // ============================================================================

  createChecklist: async (payload: {
    cardId: string;
    name: string;
    mutationId: string;
  }) => (trpc as any).checklist.create.mutateAsync(payload),

  addChecklistItem: async (payload: {
    checklistId: string;
    title: string;
    mutationId: string;
  }) => (trpc as any).checklist.addItem.mutateAsync(payload),

  updateChecklistItem: async (payload: {
    checklistId: string;
    itemId: string;
    title?: string;
    completed?: boolean;
    mutationId: string;
  }) => (trpc as any).checklist.updateItem.mutateAsync(payload),

  removeChecklistItem: async (payload: {
    checklistId: string;
    itemId: string;
    mutationId: string;
  }) => (trpc as any).checklist.removeItem.mutateAsync(payload),

  deleteChecklist: async (payload: {
    checklistId: string;
    mutationId: string;
  }) => (trpc as any).checklist.delete.mutateAsync(payload),

  // ============================================================================
  // 5.  Comments
  // ============================================================================

  addComment: async (payload: {
    cardId: string;
    body: string;
    mutationId: string;
  }) => (trpc as any).comment.create.mutateAsync(payload),

  updateComment: async (payload: {
    commentId: string;
    body: string;
    mutationId: string;
  }) => (trpc as any).comment.update.mutateAsync(payload),

  deleteComment: async (payload: {
    commentId: string;
    mutationId: string;
  }) => (trpc as any).comment.delete.mutateAsync(payload),

  // ============================================================================
  // 6.  Attachments
  // ============================================================================

  addAttachment: async (payload: {
    cardId: string;
    url: string;
    mimeType: string;
    fileName: string;
    sizeBytes: number;
    mutationId: string;
  }) => (trpc as any).attachment.add.mutateAsync(payload),

  removeAttachment: async (payload: {
    attachmentId: string;
    mutationId: string;
  }) => (trpc as any).attachment.remove.mutateAsync(payload),

  // ============================================================================
  // 7.  Templates
  // ============================================================================

  createTemplate: async (payload: {
    boardId: string;
    name: string;
    description?: string;
    structure: TemplateStructure;
    mutationId: string;
  }) => (trpc as any).template.create.mutateAsync(payload),

  deleteTemplate: async (payload: {
    templateId: string;
    mutationId: string;
  }) => (trpc as any).template.delete.mutateAsync(payload),

  applyTemplate: async (payload: {
    templateId: string;
    boardId: string;
    mutationId: string;
  }) => (trpc as any).template.apply.mutateAsync(payload),
};
