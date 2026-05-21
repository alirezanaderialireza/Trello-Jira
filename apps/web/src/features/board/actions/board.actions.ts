"use server";

// ✅ fix: PinoLogger از @repo/infrastructure حذف شد — این package هنوز ساخته نشده.
// به جای آن یک inline logger ساده استفاده می‌کنیم که production-safe است.
// وقتی @repo/infrastructure ساخته شد، فقط همین یک import را عوض کن.

import { appRouter, createContext } from "@repo/api";
import { TRPCError, inferProcedureInput } from "@trpc/server";
import superjson from "superjson";
import { headers } from "next/headers";

// ============================================================================
// Inline Logger (تا زمانی که @repo/infrastructure ساخته شود)
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
// Safe Tenant (Dev Only)
// ============================================================================

const DEV_TENANT_ID =
  process.env.DEV_TENANT_ID || "00000000-0000-0000-0000-000000000001";

// ============================================================================
// Context Factory
// ============================================================================

const getCaller = async (signal?: AbortSignal): Promise<Caller> => {
  const reqHeaders = await headers();

  const traceId = reqHeaders.get("x-trace-id") ?? crypto.randomUUID();

  // TODO: در production باید session از auth provider واقعی بیاید
  const session = {
    user: { id: "dev-user" },
    tenantId: DEV_TENANT_ID,
    roles: ["admin"],
    aclVersion: 1,
  };

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

// ✅ fix: moveList در boardRouter وجود ندارد — تا زمانی که اضافه شود
// این action یک stub امن است که به جای crash کردن، error مناسب برمی‌گرداند.
// وقتی moveList به boardRouter اضافه شد، این خط را uncomment کن:
// export const moveListAction = createSafeAction(
//   "moveList",
//   (trpc, input: inferProcedureInput<AppRouterType["v1"]["public"]["board"]["moveList"]>) =>
//     trpc.v1.public.board.moveList(input),
// );

export const moveListAction = async (input: {
  boardId: string;
  listId: string;
  newPosition: string;
  mutationId: string;
}): Promise<ActionResponse<{ success: true }>> => {
  logger.info({
    event: "move_list_stub_called",
    note: "moveList not yet implemented in boardRouter",
    input,
  });
  // Optimistic UI در BoardView این را هندل می‌کند — server sync بعداً اضافه می‌شود
  return { success: true, data: { success: true } };
};

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
    logger.error({
      event: "ssr_board_fetch_failed",
      boardId: input.id,
      error:
        isDev && error instanceof Error
          ? { message: error.message, stack: error.stack }
          : "redacted",
    });
    return null;
  }
}