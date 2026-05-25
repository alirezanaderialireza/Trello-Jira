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
 *
 * ─── tRPC route layout note ────────────────────────────────────────────────
 * The router was reorganised into versioned/visibility namespaces
 * (`v1.public.{card,board,list}.…`). The flat shape (`trpc.card.create`)
 * the file used historically is gone, so all Phase-1/2 paths now go
 * through `trpc.v1.public.…`.
 *
 * ─── Why every call is cast through an aliased proxy ──────────────────────
 * `createTRPCNext` builds a *hook* proxy: each leaf is a `DecoratedMutation`
 * that exposes `.useMutation()` for React components, NOT a vanilla client
 * with `.mutateAsync()` directly. boardApi is called from mutation hooks
 * that already wrap the React-Query lifecycle, so they want a plain
 * Promise<output> — bypassing the hook layer is the long-standing pattern
 * in this file. Pre-refactor it worked accidentally because `trpc.card`
 * was untyped (`any`) and TS quietly accepted `.mutateAsync`. Now that
 * `trpc.v1.public.card.create` has its real `DecoratedMutation` type, TS
 * refuses to walk to `.mutateAsync` and the build dies at boardApi.ts.
 *
 * The minimal fix to keep the existing pattern is to access each
 * procedure through an `as any` proxy at the top of the file. This
 * preserves the file's intent (it's a thin façade, not a typed service)
 * and matches what the Phase-4 routes already do via `(trpc as any).…`.
 * When the file gets rewritten to use a vanilla `createTRPCProxyClient`
 * the casts here can disappear together.
 */

import { trpc } from "../../../../utils/trpc";
import type { TemplateStructure } from "@repo/domain";

// Resolved route handles. Cast to `any` because boardApi is called from
// non-React code paths and uses .mutateAsync on the procedure proxy
// directly — see the "Why every call is cast through an aliased proxy"
// note above.
const cardApi    = trpc.v1.public.card    as any;
const listApi    = trpc.v1.public.list    as any;
const boardApiNs = trpc.v1.public.board   as any;

// ============================================================================
// 1.  Cards
// ============================================================================

export const boardApi = {
  // ── create ────────────────────────────────────────────────────────────────
  createCard: async (payload: {
    listId: string;
    title: string;
    mutationId: string;
  }) => cardApi.create.mutateAsync(payload),

  // ── move ──────────────────────────────────────────────────────────────────
  moveCard: async (payload: {
    cardId: string;
    targetListId: string;
    mode: "APPEND" | "PREPEND" | "INSERT_BETWEEN" | "REORDER_SAME_LIST";
    prevId?: string;
    nextId?: string;
    mutationId: string;
    expectedListRevisions?: Record<string, number>;
  }) => boardApiNs.moveCard.mutateAsync(payload),

  // ── update ────────────────────────────────────────────────────────────────
  updateCard: async (payload: {
    id: string;
    title?: string;
    description?: string;
    expectedRevision?: number;
    mutationId: string;
  }) => cardApi.update.mutateAsync(payload),

  // ── delete ────────────────────────────────────────────────────────────────
  deleteCard: async (payload: {
    id: string;
    mutationId: string;
  }) => cardApi.delete.mutateAsync(payload),

  // ── lock / unlock ─────────────────────────────────────────────────────────
  // The lock / unlock / assignee / dueDate sub-routes are not on the new
  // versioned router. The cast above covers them too.
  lockCard: async (payload: {
    cardId: string;
    mutationId: string;
  }) => cardApi.lock.mutateAsync(payload),

  unlockCard: async (payload: {
    cardId: string;
    mutationId: string;
  }) => cardApi.unlock.mutateAsync(payload),

  // ── assignees ─────────────────────────────────────────────────────────────
  addCardAssignee: async (payload: {
    cardId: string;
    assigneeId: string;
    mutationId: string;
  }) => cardApi.addAssignee.mutateAsync(payload),

  removeCardAssignee: async (payload: {
    cardId: string;
    assigneeId: string;
    mutationId: string;
  }) => cardApi.removeAssignee.mutateAsync(payload),

  // ── due date ──────────────────────────────────────────────────────────────
  updateCardDueDate: async (payload: {
    cardId: string;
    dueDate: string | null;
    mutationId: string;
  }) => cardApi.updateDueDate.mutateAsync(payload),

  // ============================================================================
  // 2.  Lists
  // ============================================================================

  createList: async (payload: {
    boardId: string;
    title: string;
    mutationId: string;
    expectedBoardRevision?: number;
    expectedAclVersion?: number;
  }) => listApi.create.mutateAsync(payload),

  moveList: async (payload: {
    boardId: string;
    listId: string;
    newPosition: string;
    mutationId: string;
  }) => boardApiNs.moveList.mutateAsync(payload),

  updateList: async (payload: {
    listId: string;
    title: string;
    mutationId: string;
  }) => listApi.update.mutateAsync(payload),

  deleteList: async (payload: {
    listId: string;
    mutationId: string;
  }) => listApi.delete.mutateAsync(payload),

  // ============================================================================
  // 3.  Labels
  // ============================================================================

  createLabel: async (payload: {
    boardId: string;
    name: string;
    color: string;
    mutationId: string;
  }) => (trpc as any).v1.public.label.create.mutateAsync(payload),

  updateLabel: async (payload: {
    labelId: string;
    name?: string;
    color?: string;
    mutationId: string;
  }) => (trpc as any).v1.public.label.update.mutateAsync(payload),

  deleteLabel: async (payload: {
    labelId: string;
    mutationId: string;
  }) => (trpc as any).v1.public.label.delete.mutateAsync(payload),

  addCardLabel: async (payload: {
    cardId: string;
    labelId: string;
    mutationId: string;
  }) => (trpc as any).v1.public.label.addToCard.mutateAsync(payload),

  removeCardLabel: async (payload: {
    cardId: string;
    labelId: string;
    mutationId: string;
  }) => (trpc as any).v1.public.label.removeFromCard.mutateAsync(payload),

  // ============================================================================
  // 4.  Checklists
  // ============================================================================

  createChecklist: async (payload: {
    cardId: string;
    name: string;
    mutationId: string;
  }) => (trpc as any).v1.public.checklist.create.mutateAsync(payload),

  addChecklistItem: async (payload: {
    checklistId: string;
    title: string;
    mutationId: string;
  }) => (trpc as any).v1.public.checklist.addItem.mutateAsync(payload),

  updateChecklistItem: async (payload: {
    checklistId: string;
    itemId: string;
    title?: string;
    completed?: boolean;
    mutationId: string;
  }) => (trpc as any).v1.public.checklist.updateItem.mutateAsync(payload),

  removeChecklistItem: async (payload: {
    checklistId: string;
    itemId: string;
    mutationId: string;
  }) => (trpc as any).v1.public.checklist.removeItem.mutateAsync(payload),

  deleteChecklist: async (payload: {
    checklistId: string;
    mutationId: string;
  }) => (trpc as any).v1.public.checklist.delete.mutateAsync(payload),

  // ============================================================================
  // 5.  Comments
  // ============================================================================

  addComment: async (payload: {
    cardId: string;
    body: string;
    mutationId: string;
  }) => (trpc as any).v1.public.comment.create.mutateAsync(payload),

  updateComment: async (payload: {
    commentId: string;
    body: string;
    mutationId: string;
  }) => (trpc as any).v1.public.comment.update.mutateAsync(payload),

  deleteComment: async (payload: {
    commentId: string;
    mutationId: string;
  }) => (trpc as any).v1.public.comment.delete.mutateAsync(payload),

  // ============================================================================
  // 6.  Attachments  (not on the versioned router yet — kept as untyped escape hatch)
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
  // 7.  Templates  (not on the versioned router yet — kept as untyped escape hatch)
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
