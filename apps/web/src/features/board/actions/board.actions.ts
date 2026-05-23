"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Server Actions for the board feature.
// Every action runs inside the Next.js Server Action runtime, looks up the
// authenticated Auth.js session via `getWebSession()`, and constructs a tRPC
// caller with that real session injected. There is no longer a hardcoded
// dev-user fallback — unauthenticated callers get a proper UNAUTHORIZED error.
// ─────────────────────────────────────────────────────────────────────────────

import { appRouter, createContext } from "@repo/api";
import { TRPCError, inferProcedureInput } from "@trpc/server";
import superjson from "superjson";
import { headers } from "next/headers";
import { getWebSession } from "@/auth/getServerSession";

// ============================================================================
// Inline Logger (until @repo/infrastructure exposes a browser-safe logger)
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

type Caller = ReturnType<typeof appRouter.createCaller>;

// ============================================================================
// Context Factory — uses the real Auth.js session
// ============================================================================
//
// `tenantHint` lets callers pass through the workspace id when they already
// know it (most board/list/card actions know their boardId, and the board
// already encodes the tenant). When omitted, the user's personal workspace is
// used. If the user is unauthenticated, we throw UNAUTHORIZED so the action
// returns a structured failure rather than silently impersonating a dev user.

const getCaller = async (
  signal?: AbortSignal,
  tenantHint?: string,
): Promise<Caller> => {
  const reqHeaders = await headers();
  const traceId = reqHeaders.get("x-trace-id") ?? crypto.randomUUID();

  const session = await getWebSession(tenantHint);
  if (!session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required.",
    });
  }

  const ctx = await createContext({
    requestId: crypto.randomUUID(),
    traceId,
    req: new Request("http://localhost", { signal }),
    session,
  });

  return appRouter.createCaller(ctx);
};

// ============================================================================
// Action Response Types
// ============================================================================

type ActionResponse<T> =
  | { success: true; data: T }
  | { success: false; code: string; message: string; isRetryable: boolean };

// ============================================================================
// Retryable Codes
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
      const trpc = await getCaller(options?.signal);
      const rawData = await execute(trpc, input);

      // superjson serialize برای SSR safety (Date, bigint, etc.)
      const safeData = superjson.serialize(rawData).json as TOutput;

      return { success: true, data: safeData };
    } catch (error: unknown) {
      const isTRPC = error instanceof TRPCError;
      const code = isTRPC ? error.code : "INTERNAL_SERVER_ERROR";
      const rawMessage =
        error instanceof Error ? error.message : "Unknown server error";

      logger.error({
        event: "server_action_failed",
        action: actionName,
        code,
        error:
          isDev && error instanceof Error
            ? { message: error.message, stack: error.stack }
            : "redacted",
      });

      return {
        success: false,
        code,
        message: isDev ? rawMessage : "Unexpected server error",
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

export const updateCardAction = createSafeAction(
  "updateCard",
  (trpc, input: inferProcedureInput<AppRouterType["v1"]["public"]["card"]["update"]>) =>
    trpc.v1.public.card.update(input),
);

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

// ============================================================================
// Board Actions
// ============================================================================

export const moveCardAction = createSafeAction(
  "moveCard",
  (trpc, input: inferProcedureInput<AppRouterType["v1"]["public"]["board"]["moveCard"]>) =>
    trpc.v1.public.board.moveCard(input),
);

// ✅ Phase 0.2: real backing for list reorder.
// Wired through trpc.v1.public.board.moveList → MoveListHandler →
// moveListUseCase. The optimistic UI in BoardView now has a real server
// counterpart, and rollback is triggered automatically by createSafeAction
// when the server returns success: false.
export const moveListAction = createSafeAction(
  "moveList",
  (
    trpc,
    input: inferProcedureInput<
      AppRouterType["v1"]["public"]["board"]["moveList"]
    >,
  ) => trpc.v1.public.board.moveList(input),
);

// ============================================================================
// Get Board Data (SSR)
// ============================================================================

type GetBoardInput = inferProcedureInput<
  AppRouterType["v1"]["public"]["board"]["getFullBoard"]
>;

type GetBoardOutput = Awaited<
  ReturnType<Caller["v1"]["public"]["board"]["getFullBoard"]>
>;

export async function getBoardData(
  input: GetBoardInput,
): Promise<GetBoardOutput | null> {
  try {
    const trpc = await getCaller();
    const rawData = await trpc.v1.public.board.getFullBoard(input);
    return superjson.serialize(rawData).json as GetBoardOutput;
  } catch (error) {
    // tRPC's `inferProcedureInput` widens GetBoardInput to
    // `void | { id?: string; ... }` because board.getFullBoard accepts
    // either an id+pagination object or no argument at all to fall back
    // to the user's default board.
    //
    // With `strictNullChecks: false` in apps/web's tsconfig, optional
    // chaining only filters `null | undefined`, not `void` — so
    // `input?.id` still fails the type check on the void branch. We
    // therefore narrow with a type assertion that strips `void` from the
    // union before reading `.id`. Behaviour at runtime is unchanged
    // (`void` values don't carry an `id` and yield `undefined` either way).
    const inputForLog = input as Exclude<GetBoardInput, void> | undefined;

    logger.error({
      event: "ssr_board_fetch_failed",
      boardId: inputForLog?.id,
      error:
        isDev && error instanceof Error
          ? { message: error.message, stack: error.stack }
          : "redacted",
    });
    return null;
  }
}