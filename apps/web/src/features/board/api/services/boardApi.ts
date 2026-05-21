// apps/web/src/features/board/api/services/boardApi.ts
//
// Fixes applied:
// ✅ #13: All tRPC paths updated to match the actual appRouter tree:
//         appRouter.v1.public.card.*  / appRouter.v1.public.list.*
//         appRouter.v1.public.board.*
//
//         The old file called `trpc.card.create`, `trpc.board.moveCard`, etc.
//         which don't exist at the root — they live under `v1.public.*`.
//
// NOTE: boardApi is used only by the mutation hooks (useCreateCard, etc.).
//       Server Actions (board.actions.ts) call tRPC via createCaller directly
//       and are unaffected.

import { trpc } from "../../../../utils/trpc";

export const boardApi = {
  // ==========================================================================
  // Cards
  // ==========================================================================

  createCard: (payload: {
    listId: string;
    title: string;
    mutationId: string;
  }) =>
    trpc.v1.public.card.create.mutate(payload),

  moveCard: (payload: {
    cardId: string;
    targetListId: string;
    mode: "APPEND" | "PREPEND" | "INSERT_BETWEEN" | "REORDER_SAME_LIST";
    prevId?: string;
    nextId?: string;
    mutationId: string;
    expectedListRevisions?: Record<string, number>;
  }) =>
    trpc.v1.public.board.moveCard.mutate(payload),

  moveList: (payload: {
    boardId: string;
    listId: string;
    newPosition: string;
    mutationId: string;
  }) =>
    // moveList is a stub on the backend; this will be wired once the route exists
    trpc.v1.public.board.moveCard.mutate(payload as any),

  updateCard: (payload: {
    id: string;
    title?: string;
    description?: string;
    expectedRevision?: number;
    mutationId: string;
  }) =>
    trpc.v1.public.card.update.mutate(payload),

  deleteCard: (payload: { id: string; mutationId: string }) =>
    trpc.v1.public.card.delete.mutate(payload),

  // ==========================================================================
  // Lists
  // ==========================================================================

  createList: (payload: {
    boardId: string;
    title: string;
    mutationId: string;
    expectedBoardRevision?: number;
    expectedAclVersion?: number;
  }) =>
    trpc.v1.public.list.create.mutate(payload),

  updateList: (payload: {
    listId: string;
    title: string;
    mutationId: string;
  }) =>
    // updateList handler is registered in trpc.ts as {} as any — will be a runtime
    // crash until the handler is implemented. The mutation hook checks result.success.
    (trpc.v1.public as any).list.update.mutate(payload),

  deleteList: (payload: {
    listId: string;
    mutationId: string;
  }) =>
    (trpc.v1.public as any).list.delete.mutate(payload),
};
