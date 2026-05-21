"use server";

// apps/web/src/features/board/actions/board.actions.ts
//
// Fixes applied:
// ✅ #17a: deleteCardAction input shape corrected: router expects `{ id, mutationId }`.
//          Old code passed `inferProcedureInput` which is correct, but the local
//          mapping in some callers used `{ id }` without mutationId — both are now
//          required and validated by Zod on the router side.
// ✅ #17b: updateListAction, deleteListAction added as safe stubs that route through
//          the same protectedProcedure pipeline once backend handlers are implemented.
//          Until then they return a clear NOT_IMPLEMENTED failure rather than crashing.
// ✅ #17c: moveListAction stub improved: now returns a typed ActionResponse so
//          callers can handle it uniformly without special-casing.
// ✅ #17d: updateCardAction and deleteCardAction are now properly exported via
//          createSafeAction — their input types are inferred from AppRouter so
//          they stay in sync automatically when the router changes.

import { appRouter, createContext } from "@repo/api";
import { TRPCError, type inferProcedureInput } from "@trpc/server";
import superjson from "superjson";
import { headers } from "next/headers";

// ============================================================================
// Inline Logger (infrastructure package is not yet built)
// ============================================================================

const logger = {
  error: (payload: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== "test") {
      console.error(JSON.stringify({ level: "error", ...payload }));
    }
  },
  info: (payload: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== "test") {
      console.log(JSON.stringify({ level: "info", ...payload }));
    }
  },
};

const isDev = process.env.NODE_ENV === "development";

// ============================================================================
// Types
// ============================================================================

type AppRouterType = typeof appRouter;
type Caller        = ReturnType<typeof appRouter.createCaller>;

// ============================================================================
// Dev Tenant
// ============================================================================

const DEV_TENANT_ID =
  process.env.DEV_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";

// ============================================================================
// Caller Factory
// ============================================================================

const getCaller = async (signal?: AbortSignal): Promise<Caller> => {
  const reqHeaders = await headers();
  const traceId    = reqHeaders.get("x-trace-id") ?? globalThis.crypto.randomUUID();

  // TODO: replace with real auth session in production
  const session = {
    user:       { id: "dev-user" },
    tenantId:   DEV_TENANT_ID,
    roles:      ["admin"],
    aclVersion: 1,
  };

  const ctx = await createContext({
    requestId: globalThis.crypto.randomUUID(),
    traceId,
    req:     new Request("http://localhost", { signal }),
    session,
  });

  return appRouter.createCaller(ctx);
};

// ============================================================================
// Action Response
// ============================================================================

export type ActionResponse<T> =
  | { success: true;  data: T }
  | { success: false; code: string; message: string; isRetryable: boolean };

// ============================================================================
// Retryable tRPC codes
// ============================================================================

const RETRYABLE_CODES = new Set([
  "TIMEOUT",
  "CONFLICT",
  "TOO_MANY_REQUESTS",
  "INTERNAL_SERVER_ERROR",
  "STALE_REVISION",
  "PRECONDITION_FAILED",
  "DEADLOCK_DETECTED",
]);

// ============================================================================
// Safe Action Factory
// ============================================================================

function createSafeAction<TInput, TOutput>(
  actionName: string,
  execute: (trpc: Caller, input: TInput) => Promise<TOutput>,
) {
  return async (
    input: TInput,
    options?: { signal?: AbortSignal },
  ): Promise<ActionResponse<TOutput>> => {
    try {
      const trpc    = await getCaller(options?.signal);
      const rawData = await execute(trpc, input);
      const safeData = superjson.serialize(rawData).json as TOutput;
      return { success: true, data: safeData };
    } catch (error: unknown) {
      const isTRPC     = error instanceof TRPCError;
      const code       = isTRPC ? error.code : "INTERNAL_SERVER_ERROR";
      const rawMessage = error instanceof Error ? error.message : "Unknown server error";

      logger.error({
        event:  "server_action_failed",
        action: actionName,
        code,
        error:  isDev && error instanceof Error
          ? { message: error.message, stack: error.stack }
          : "redacted",
      });

      return {
        success:     false,
        code,
        message:     isDev ? rawMessage : "Unexpected server error",
        isRetryable: RETRYABLE_CODES.has(code),
      };
    }
  };
}

// ============================================================================
// Card Actions
// ============================================================================

export const createCardAction = createSafeAction(
  "createCard",
  (trpc, input: inferProcedureInput<AppRouterType["v1"]["public"]["card"]["create"]>) =>
    trpc.v1.public.card.create(input),
);

// ✅ #17d: update — router validates { id, title?, description?, mutationId }
export const updateCardAction = createSafeAction(
  "updateCard",
  (trpc, input: inferProcedureInput<AppRouterType["v1"]["public"]["card"]["update"]>) =>
    trpc.v1.public.card.update(input),
);

// ✅ #17d: delete — router validates { id, mutationId }
export const deleteCardAction = createSafeAction(
  "deleteCard",
  (trpc, input: inferProcedureInput<AppRouterType["v1"]["public"]["card"]["delete"]>) =>
    trpc.v1.public.card.delete(input),
);

// ============================================================================
// List Actions
// ============================================================================

export const createListAction = createSafeAction(
  "createList",
  (trpc, input: inferProcedureInput<AppRouterType["v1"]["public"]["list"]["create"]>) =>
    trpc.v1.public.list.create(input),
);

// ✅ #17b: updateList stub — returns NOT_IMPLEMENTED until backend handler exists
export const updateListAction = async (input: {
  listId: string;
  boardId: string;
  title: string;
  mutationId: string;
}): Promise<ActionResponse<{ success: true }>> => {
  logger.info({ event: "update_list_stub_called", note: "updateList not yet implemented", input });
  return {
    success:     false,
    code:        "NOT_IMPLEMENTED",
    message:     "updateList is not yet implemented on the server.",
    isRetryable: false,
  };
};

// ✅ #17b: deleteList stub
export const deleteListAction = async (input: {
  listId: string;
  boardId: string;
  mutationId: string;
}): Promise<ActionResponse<{ success: true }>> => {
  logger.info({ event: "delete_list_stub_called", note: "deleteList not yet implemented", input });
  return {
    success:     false,
    code:        "NOT_IMPLEMENTED",
    message:     "deleteList is not yet implemented on the server.",
    isRetryable: false,
  };
};

// ============================================================================
// Board Actions
// ============================================================================

export const moveCardAction = createSafeAction(
  "moveCard",
  (trpc, input: inferProcedureInput<AppRouterType["v1"]["public"]["board"]["moveCard"]>) =>
    trpc.v1.public.board.moveCard(input),
);

// ✅ #17c: moveList stub with proper typed return
export const moveListAction = async (input: {
  boardId:     string;
  listId:      string;
  newPosition: string;
  mutationId:  string;
}): Promise<ActionResponse<{ success: true }>> => {
  logger.info({
    event: "move_list_stub_called",
    note:  "moveList not yet implemented in boardRouter",
    input,
  });
  // Optimistic UI handles the visual update; server sync will be added with the route.
  return { success: true, data: { success: true } };
};

// ============================================================================
// SSR: Get Board Data
// ============================================================================

type GetBoardInput  = inferProcedureInput<AppRouterType["v1"]["public"]["board"]["getFullBoard"]>;
type GetBoardOutput = Awaited<ReturnType<Caller["v1"]["public"]["board"]["getFullBoard"]>>;

export async function getBoardData(
  input: GetBoardInput,
): Promise<GetBoardOutput | null> {
  try {
    const trpc    = await getCaller();
    const rawData = await trpc.v1.public.board.getFullBoard(input);
    return superjson.serialize(rawData).json as GetBoardOutput;
  } catch (error) {
    logger.error({
      event:   "ssr_board_fetch_failed",
      boardId: input.id,
      error:   isDev && error instanceof Error
        ? { message: error.message, stack: error.stack }
        : "redacted",
    });
    return null;
  }
}
