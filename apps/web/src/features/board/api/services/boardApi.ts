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

  // ── assignees (Phase 1.2 — F1.2.5) ─────────────────────────────────────
  // Fixes runtime crash: cardApi.addAssignee / removeAssignee never existed.
  // Now routes to v1.public.cardAssignee.* with boardId + idempotencyKey.
  addCardAssignee: async (payload: {
    cardId:         string;
    boardId:        string;
    assigneeId:     string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.cardAssignee.addAssignee.mutateAsync(payload),

  removeCardAssignee: async (payload: {
    cardId:         string;
    boardId:        string;
    assigneeId:     string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.cardAssignee.removeAssignee.mutateAsync(payload),

  listCardAssignees: async (payload: {
    boardId: string;
    cardId:  string;
  }) => (trpc as any).v1.public.cardAssignee.list.query(payload),

  // ── due date ──────────────────────────────────────────────────────────────
  // Phase 1.2 (F1.2.2) — replaces the F1.2.1-era stub which targeted a
  // non-existent `cardApi.updateDueDate`. The new procedure lives at
  // `v1.public.dueDate.setDueDate` and accepts the canonical DateOnly
  // wire shape (YYYY-MM-DD) plus the standard idempotencyKey. boardId
  // is required because the procedure rides on boardProtectedProcedure
  // (boardMemberGuard reads boardId from rawInput).
  setCardDueDate: async (payload: {
    cardId: string;
    boardId: string;
    /** `YYYY-MM-DD` (DateOnly) or null to clear. NOT an ISO datetime. */
    dueDate: string | null;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.dueDate.setDueDate.mutateAsync(payload),

  /**
   * @deprecated since F1.2.2 — use `setCardDueDate` instead. Left as
   * a redirect for any uncaught caller in dev branches; will be
   * removed in F1.2.3 once the call sites are audited.
   */
  updateCardDueDate: async (payload: {
    cardId: string;
    dueDate: string | null;
    mutationId: string;
  }) => {
    throw new Error(
      "boardApi.updateCardDueDate is removed. Use boardApi.setCardDueDate({ cardId, boardId, dueDate, idempotencyKey }).",
    );
  },

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
    colorToken: string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.label.create.mutateAsync(payload),

  updateLabel: async (payload: {
    labelId: string;
    name?: string;
    colorToken?: string;
    position?: string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.label.update.mutateAsync(payload),

  deleteLabel: async (payload: {
    labelId: string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.label.delete.mutateAsync(payload),

  /**
   * Procedure renamed in F1.2.1 from `addToCard` to `applyToCard`. The
   * boardApi facade keeps its own method name (`addCardLabel`) so the
   * existing optimistic-mutation hooks don't need to rename their
   * imports — only the wire-level call has changed.
   */
  addCardLabel: async (payload: {
    boardId: string;
    cardId: string;
    labelId: string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.label.applyToCard.mutateAsync(payload),

  removeCardLabel: async (payload: {
    boardId: string;
    cardId: string;
    labelId: string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.label.removeFromCard.mutateAsync(payload),

  // ============================================================================
  // 4.  Checklists
  // ============================================================================

  // ============================================================================
  // 4.  Checklists
  // ============================================================================
  // Phase 1.2 (F1.2.3.a). Procedure path stays at `v1.public.checklist.*`
  // (singular — root mount in packages/api/src/index.ts). Wire field
  // names and idempotencyKey (was mutationId) updated to the v2
  // contract. boardId is now required on every mutation because the
  // boardProtectedProcedure middleware reads it from rawInput.

  createChecklist: async (payload: {
    cardId: string;
    boardId: string;
    title: string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.checklist.create.mutateAsync(payload),

  /**
   * D12 — rename / reorder a checklist via field mask.
   */
  updateChecklist: async (payload: {
    checklistId: string;
    boardId: string;
    title?: string;
    position?: string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.checklist.updateChecklist.mutateAsync(payload),

  addChecklistItem: async (payload: {
    checklistId: string;
    boardId: string;
    text: string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.checklist.addItem.mutateAsync(payload),

  /**
   * D10 toggle / D11 reorder / rename — single procedure with field
   * mask. All three fields optional; pass only what changes.
   */
  updateChecklistItem: async (payload: {
    checklistItemId: string;
    boardId: string;
    text?: string;
    isDone?: boolean;
    position?: string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.checklist.updateItem.mutateAsync(payload),

  removeChecklistItem: async (payload: {
    checklistItemId: string;
    boardId: string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.checklist.removeItem.mutateAsync(payload),

  deleteChecklist: async (payload: {
    checklistId: string;
    boardId: string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.checklist.deleteChecklist.mutateAsync(payload),

  // ============================================================================
  // 5.  Comments
  // ============================================================================
  //
  // Phase 1.2 (F1.2.4.a) — v2 contract. All methods now require boardId +
  // idempotencyKey (was: mutationId, which was never sent to the server).
  // The old `addComment` / `deleteComment` signatures are replaced; the
  // facade method names align with the router procedure names (create /
  // update / delete) for discoverability.

  createComment: async (payload: {
    cardId:         string;
    boardId:        string;
    body:           string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.comment.create.mutateAsync(payload),

  updateComment: async (payload: {
    commentId:      string;
    boardId:        string;
    body:           string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.comment.update.mutateAsync(payload),

  deleteComment: async (payload: {
    commentId:      string;
    boardId:        string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.comment.delete.mutateAsync(payload),

  /**
   * Cursor-based list — used by CardComments (F1.2.4.b) to hydrate the
   * store. Renamed from getByCard → list to match the router procedure.
   */
  listComments: async (payload: {
    boardId:  string;
    cardId:   string;
    cursor?:  string;
    limit?:   number;
  }) => (trpc as any).v1.public.comment.list.query(payload),

  // ── Deprecated shims (F1.2.4.a) ─────────────────────────────────────────
  // Kept so any call sites that still reference the old names get a clear
  // runtime error in development instead of a silent no-op.
  // TODO F1.2.4.b: remove once CardComments.tsx is rewritten.

  /** @deprecated — use createComment */
  addComment: async (_payload: unknown): Promise<never> => {
    throw new Error(
      "boardApi.addComment is removed. Use boardApi.createComment({ cardId, boardId, body, idempotencyKey }).",
    );
  },

  // ============================================================================
  // 8.  Card Cover  (Phase 1.2 — F1.2.7)
  // ============================================================================

  setCardCover: async (payload: {
    cardId:         string;
    boardId:        string;
    coverData:      { type: string; id: string; url?: string } | null;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.cover.setCover.mutateAsync(payload),

  // ============================================================================
  // 6.  Attachments  (Phase 1.2 — F1.2.8)
  // ============================================================================
  // Fixes runtime crash: previous methods called (trpc as any).attachment.add /
  // .remove which never existed. Now routes to v1.public.attachment.*.

  removeAttachment: async (payload: {
    attachmentId:   string;
    boardId:        string;
    cardId:         string;
    idempotencyKey: string;
    correlationId?: string;
  }) => (trpc as any).v1.public.attachment.remove.mutateAsync(payload),

  listAttachments: async (payload: {
    boardId: string;
    cardId:  string;
  }) => (trpc as any).v1.public.attachment.list.query(payload),

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
