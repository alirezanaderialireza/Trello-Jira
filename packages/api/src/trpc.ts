// packages/api/src/trpc.ts
//
// Fixes applied:
// ✅ #T-01: All {} as any stubs replaced with real command handler instances:
//           createCard, updateCard, deleteCard, updateList, deleteList, moveList
//           Each handler wraps the domain use-case function in a CommandHandler
//           adapter that supplies the required deps (generateCardId, now, etc.)
//           so the use-case stays pure and infrastructure-agnostic.
// ✅ #T-02: readModels now exposes `.list` alias pointing to itself so
//           ctx.readModels.list.getListsByBoard works (BoardReadModels has
//           `public list = this` already — this comment explains the intent).
// ✅ #T-03: `performance` imported from node:perf_hooks for observabilityMiddleware
//           (was using bare `performance` which may not be globalThis in Node 16).

import { performance } from "node:perf_hooks";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { AsyncLocalStorage } from "async_hooks";

// ── Database ─────────────────────────────────────────────────────────────────
import { db } from "@repo/db";
import {
  DrizzleCardRepository,
  DrizzleListRepository,
  DrizzleBoardRepository,
  DrizzleOutboxRepository,
  DrizzleAuditRepository,
  DrizzleIdempotencyRepository,
  DrizzleSequenceRepository,
  BoardReadModels,
} from "@repo/db";

// ── Infrastructure ────────────────────────────────────────────────────────────
import {
  PinoLogger,
  DistributedLockManager,
  TransactionManager,
  RedisManager,
  RedisRateLimiter,
  RedisPresenceStore,
  RedisPubSub,
} from "@repo/infrastructure";

// ── Domain Services ───────────────────────────────────────────────────────────
import { BoardService } from "./services/board.service";

// ── Domain Handlers (class-based) ────────────────────────────────────────────
import { CreateListHandler } from "@repo/domain";

// ── Domain Use-Cases (function-based) ────────────────────────────────────────
// ✅ #T-01: imported via @repo/domain barrel — avoids relative cross-package paths
//           Each use-case is exported from domain/src/index.ts
import {
  createCardUseCase,
  updateCardUseCase,
  deleteCardUseCase,
  updateListUseCase,
  deleteListUseCase,
  moveListUseCase,
} from "@repo/domain";

// ============================================================================
// Singletons
// ============================================================================

const dbInstance = db as any;

const redisManager = new RedisManager(
  process.env.REDIS_URL ?? "redis://localhost:6379",
);

const logger      = new PinoLogger();
const txManager   = new TransactionManager(dbInstance);
const lockManager = new DistributedLockManager(dbInstance);
const rateLimiter = new RedisRateLimiter(redisManager.client);
const presenceStore = new RedisPresenceStore(redisManager.client);
const pubsub      = new RedisPubSub(redisManager.pubsub);

// ============================================================================
// ALS
// ============================================================================

export type Session = {
  user:       { id: string };
  tenantId:   string;
  aclVersion: number;
  roles:      string[];
};

export type RequestMetadata = {
  requestId:    string;
  traceId:      string;
  spanId:       string;
  causationId?: string;
  ip?:          string;
  userAgent?:   string;
  startedAt:    number;
};

export const requestContextALS = new AsyncLocalStorage<{
  traceId:     string;
  requestId:   string;
  spanId:      string;
  abortSignal?: AbortSignal;
}>();

// ============================================================================
// Infrastructure Container
// ============================================================================

const infrastructure = Object.freeze({
  db:           dbInstance,
  logger,
  txManager,
  lockManager,
  rateLimiter,
  presenceStore,
  pubsub,
});

// ============================================================================
// Repositories
// ============================================================================

const repositories = Object.freeze({
  card:       new DrizzleCardRepository(dbInstance) as any,
  list:       new DrizzleListRepository(dbInstance),
  board:      new DrizzleBoardRepository(dbInstance),
  outbox:     new DrizzleOutboxRepository(dbInstance),
  audit:      new DrizzleAuditRepository(dbInstance),
  idempotency: new DrizzleIdempotencyRepository(dbInstance),
  sequence:   new DrizzleSequenceRepository(dbInstance),
});

// ============================================================================
// Read Models
// ============================================================================

const readModels = new BoardReadModels(dbInstance);

// ============================================================================
// Shared deps factory for pure use-cases
// ============================================================================
// ✅ #T-01: use-cases are infrastructure-agnostic — they receive deps as
//           plain functions injected here at the composition root.

const makeDeps = () => ({
  generateCardId:      () => crypto.randomUUID(),
  generateEventId:     () => crypto.randomUUID(),
  generateCorrelationId: () => crypto.randomUUID(),
  now:                 () => new Date(),
});

// ============================================================================
// ✅ #T-01: CommandHandler adapters
//    Each adapter satisfies the `execute(input): Promise<Result>` contract
//    that the routers expect on ctx.services.commands.*
// ============================================================================

const createCardHandler = {
  execute: (input: {
    listId: string;
    title: string;
    mutationId: string;
    tenantId: string;
    userId: string;
    correlationId?: string;
    traceId?: string;
    spanId?: string;
  }) =>
    createCardUseCase(
      { listId: input.listId, title: input.title, tenantId: input.tenantId,
        userId: input.userId, correlationId: input.correlationId },
      txManager,
      repositories.list,
      repositories.card,
      repositories.outbox,
      makeDeps(),
    ),
};

const updateCardHandler = {
  execute: (input: {
    id: string;
    title?: string;
    description?: string;
    expectedRevision?: number;
    mutationId: string;
    tenantId: string;
    userId: string;
    correlationId?: string;
    traceId?: string;
    spanId?: string;
  }) =>
    updateCardUseCase(
      { cardId: input.id, title: input.title, description: input.description,
        tenantId: input.tenantId, userId: input.userId, mutationId: input.mutationId,
        correlationId: input.correlationId },
      txManager,
      repositories.list,
      repositories.card,
      repositories.outbox,
      repositories.idempotency,
      repositories.audit,
      repositories.sequence,
      makeDeps(),
    ),
};

const deleteCardHandler = {
  execute: (input: {
    id: string;
    mutationId: string;
    tenantId: string;
    userId: string;
    correlationId?: string;
    traceId?: string;
    spanId?: string;
  }) =>
    deleteCardUseCase(
      { cardId: input.id, tenantId: input.tenantId, userId: input.userId,
        correlationId: input.correlationId },
      txManager,
      repositories.card,
      repositories.outbox,
      makeDeps(),
    ),
};

const updateListHandler = {
  execute: (input: {
    listId: string;
    boardId: string;
    title?: string;
    mutationId: string;
    tenantId: string;
    userId: string;
    correlationId?: string;
    traceId?: string;
    spanId?: string;
  }) =>
    updateListUseCase(
      { listId: input.listId, boardId: input.boardId, title: input.title,
        tenantId: input.tenantId, userId: input.userId, mutationId: input.mutationId,
        correlationId: input.correlationId },
      txManager,
      repositories.list,
      repositories.outbox,
      repositories.sequence,
      repositories.idempotency,
      repositories.audit,
      makeDeps(),
    ),
};

const deleteListHandler = {
  execute: (input: {
    listId: string;
    boardId: string;
    mutationId: string;
    tenantId: string;
    userId: string;
    correlationId?: string;
    traceId?: string;
    spanId?: string;
  }) =>
    deleteListUseCase(
      { boardId: input.boardId, listId: input.listId, tenantId: input.tenantId,
        userId: input.userId, correlationId: input.correlationId },
      txManager,
      repositories.list,
      repositories.outbox,
      repositories.sequence,
      makeDeps(),
    ),
};

const moveListHandler = {
  execute: (input: {
    boardId:     string;
    listId:      string;
    newPosition: string;
    mutationId:  string;
    tenantId:    string;
    userId:      string;
    correlationId?: string;
  }) =>
    moveListUseCase(
      { boardId: input.boardId, listId: input.listId, newPosition: input.newPosition,
        tenantId: input.tenantId, userId: input.userId, correlationId: input.correlationId },
      txManager,
      repositories.list,
      repositories.outbox,
      repositories.sequence,
      makeDeps(),
    ),
};

// ============================================================================
// Services
// ============================================================================

const services = Object.freeze({
  board: new BoardService(
    txManager,
    repositories.card,
    repositories.list,
    repositories.outbox,
    repositories.idempotency,
    repositories.audit,
    repositories.sequence,
    lockManager,
    logger,
  ),

  commands: {
    // ✅ #T-01: all handlers are now real implementations — no {} as any
    createList:  new CreateListHandler(
      txManager,
      repositories.list,
      repositories.board,
      repositories.outbox,
      repositories.sequence,
      logger,
      // ✅ #D-13: inject deps explicitly — CreateListHandler no longer has defaults
      { generateId: () => crypto.randomUUID(), now: () => new Date() },
    ),
    createCard:  createCardHandler,
    updateCard:  updateCardHandler,
    deleteCard:  deleteCardHandler,
    updateList:  updateListHandler,
    deleteList:  deleteListHandler,
    moveList:    moveListHandler,
  },
});

// ============================================================================
// Context Factory
// ============================================================================

export async function createContext(opts: {
  req?:        Request;
  session?:    Session | null;
  requestId?:  string;
  traceId?:    string;
  spanId?:     string;
  causationId?: string;
  ip?:         string;
  userAgent?:  string;
}) {
  const startedAt = Date.now();
  const requestId = opts.requestId ?? crypto.randomUUID();
  const traceId   = opts.traceId   ?? crypto.randomUUID();
  const spanId    = opts.spanId    ?? crypto.randomUUID();

  const metadata = Object.freeze<RequestMetadata>({
    requestId,
    traceId,
    spanId,
    causationId: opts.causationId,
    ip:          opts.ip,
    userAgent:   opts.userAgent,
    startedAt,
  });

  return {
    infra:      infrastructure,
    repos:      repositories,
    readModels,
    services,
    session:    opts.session ?? null,
    reqSignal:  opts.req?.signal,
    metadata,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

// ============================================================================
// tRPC Init
// ============================================================================

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error, ctx }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        traceId: ctx?.metadata.traceId,
        stack:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
    };
  },
});

export const router           = t.router;
export const publicProcedure  = t.procedure;

// ============================================================================
// Middlewares
// ============================================================================

// ── Load Shedding ─────────────────────────────────────────────────────────────
const loadSheddingGuard = t.middleware(async ({ next }) => {
  // TODO: wire real pool-pressure metrics
  const isDatabaseSaturated = false;
  if (isDatabaseSaturated) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "SYSTEM_OVERLOADED: Database connection pool is saturated.",
    });
  }
  return next();
});

// ── Async Local Storage ───────────────────────────────────────────────────────
const alsMiddleware = t.middleware(async ({ ctx, next }) =>
  requestContextALS.run(
    { traceId: ctx.metadata.traceId, requestId: ctx.metadata.requestId,
      spanId: ctx.metadata.spanId, abortSignal: ctx.reqSignal },
    () => next(),
  ),
);

// ── Authentication ─────────────────────────────────────────────────────────────
const isAuthed = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required." });
  }
  return next({ ctx: { session: ctx.session } });
});

// ── Tenant Isolation ───────────────────────────────────────────────────────────
const tenantGuard = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session?.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Tenant isolation failure." });
  }
  return next();
});

// ── Timeout / Abort ────────────────────────────────────────────────────────────
const timeoutGuard = t.middleware(async ({ ctx, next }) => {
  const controller = new AbortController();

  const onAbort = () => {
    if (!controller.signal.aborted) controller.abort("CLIENT_DISCONNECTED");
  };

  if (ctx.reqSignal) ctx.reqSignal.addEventListener("abort", onAbort);

  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort("SERVER_TIMEOUT");
  }, 10_000);

  try {
    return await next({ ctx: { ...ctx, runtimeAbortSignal: controller.signal } });
  } finally {
    if (ctx.reqSignal) ctx.reqSignal.removeEventListener("abort", onAbort);
    clearTimeout(timeout);
  }
});

// ── Observability ──────────────────────────────────────────────────────────────
const observabilityMiddleware = t.middleware(async ({ path, type, ctx, next }) => {
  // ✅ #T-03: node:perf_hooks import at top — consistent across Node versions
  const started = performance.now();

  try {
    const result = await next();
    ctx.infra.logger.info({
      event:     "trpc_request_completed",
      path,
      type,
      durationMs: Math.round(performance.now() - started),
      traceId:   ctx.metadata.traceId,
      userId:    ctx.session?.user?.id,
      tenantId:  ctx.session?.tenantId,
    });
    return result;
  } catch (error: any) {
    ctx.infra.logger.error({
      event:          "trpc_request_failed",
      classification: "INTERNAL",
      path,
      type,
      durationMs: Math.round(performance.now() - started),
      traceId:   ctx.metadata.traceId,
      userId:    ctx.session?.user?.id,
      tenantId:  ctx.session?.tenantId,
      errorCode: error.code ?? "UNKNOWN",
    });
    throw error;
  }
});

// ============================================================================
// Protected Procedure
// ============================================================================

export const protectedProcedure = t.procedure
  .use(loadSheddingGuard)
  .use(alsMiddleware)
  .use(observabilityMiddleware)
  .use(timeoutGuard)
  .use(isAuthed)
  .use(tenantGuard);
