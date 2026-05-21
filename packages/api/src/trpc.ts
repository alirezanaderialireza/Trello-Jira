import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { AsyncLocalStorage } from "async_hooks";

// 📦 Auth
import { getSessionFromRequest, type AuthSession } from "@repo/auth";

// 📦 Database
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
  boardMembers,
} from "@repo/db";

// 📦 ORM operators (for board membership guard)
import { eq, and, isNull } from "drizzle-orm";

// 📦 Infrastructure
import {
  PinoLogger,
  DistributedLockManager,
  TransactionManager,
  RedisManager,
  RedisRateLimiter,
  RedisPresenceStore,
  RedisPubSub,
} from "@repo/infrastructure";

// 🌟 Services
import { BoardService } from "./services/board.service";

// 🌟 Domain Handlers
import { CreateListHandler } from "@repo/domain";

// ============================================================================
// 🛡️ Global Singletons & Connections
// ============================================================================

// 🌟 workaround برای monorepo typing
const dbInstance = db as any;

// 🌟 Redis
const redisManager = new RedisManager(
  process.env.REDIS_URL || "redis://localhost:6379"
);

// 🌟 Infra
const logger = new PinoLogger();

const txManager = new TransactionManager(
  dbInstance
);

const lockManager =
  new DistributedLockManager(dbInstance);

// 🌟 Distributed infra
const rateLimiter = new RedisRateLimiter(
  redisManager.client
);

const presenceStore =
  new RedisPresenceStore(
    redisManager.client
  );

const pubsub = new RedisPubSub(
  redisManager.pubsub
);

// ============================================================================
// 🧠 ALS
// ============================================================================

export type Session = {
  user: {
    id: string;
  };

  tenantId: string;

  aclVersion: number;

  roles: string[];
};

export type RequestMetadata = {
  requestId: string;

  traceId: string;

  spanId: string;

  causationId?: string;

  ip?: string;

  userAgent?: string;

  startedAt: number;
};

export const requestContextALS =
  new AsyncLocalStorage<{
    traceId: string;

    requestId: string;

    spanId: string;

    abortSignal?: AbortSignal;
  }>();

// ============================================================================
// 🚀 Infrastructure Container
// ============================================================================

const infrastructure = Object.freeze({
  db: dbInstance,

  logger,

  txManager,

  lockManager,

  rateLimiter,

  presenceStore,

  pubsub,
});

// ============================================================================
// 🚀 Repositories
// ============================================================================

const repositories = Object.freeze({
  // 🌟 any فقط برای conflict typing
  card: new DrizzleCardRepository(
    dbInstance
  ) as any,

  list: new DrizzleListRepository(
    dbInstance
  ),

  board: new DrizzleBoardRepository(
    dbInstance
  ),

  outbox: new DrizzleOutboxRepository(
    dbInstance
  ),

  audit: new DrizzleAuditRepository(
    dbInstance
  ),

  idempotency:
    new DrizzleIdempotencyRepository(
      dbInstance
    ),

  sequence:
    new DrizzleSequenceRepository(
      dbInstance
    ),
});

// ============================================================================
// 🚀 Read Models
// ============================================================================

const readModels = new BoardReadModels(
  dbInstance
);

// ============================================================================
// 🚀 Services
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

    logger
  ),

  commands: {
    // =========================================================================
    // ✅ Implemented
    // =========================================================================

    createList: new CreateListHandler(
      txManager,

      repositories.list,

      repositories.board,

      repositories.outbox,

      repositories.sequence,

      logger
    ),

    // =========================================================================
    // ⏳ TODO
    // =========================================================================

    moveList: {} as any,

    createCard: {} as any,

    updateCard: {} as any,

    deleteCard: {} as any,

    updateList: {} as any,

    deleteList: {} as any,
  },
});

// ============================================================================
// 🚀 Context Factory
// ============================================================================

export async function createContext(opts: {
  req?: Request;

  session?: Session | null;

  requestId?: string;

  traceId?: string;

  spanId?: string;

  causationId?: string;

  ip?: string;

  userAgent?: string;
}) {
  const startedAt = Date.now();

  const requestId =
    opts.requestId ??
    crypto.randomUUID();

  const traceId =
    opts.traceId ??
    crypto.randomUUID();

  const spanId =
    opts.spanId ??
    crypto.randomUUID();

  const metadata =
    Object.freeze<RequestMetadata>({
      requestId,

      traceId,

      spanId,

      causationId: opts.causationId,

      ip: opts.ip,

      userAgent: opts.userAgent,

      startedAt,
    });

  // ── Session resolution ─────────────────────────────────────────────────────
  // Priority: explicit opts.session > extract from Auth.js > extract from @repo/auth > null
  let session: Session | null = opts.session ?? null;

  if (!session && opts.req) {
    // Resolve session from @repo/auth JWT (HTTP, WS, API-key clients)
    const authSession: AuthSession | null = await getSessionFromRequest(opts.req);
    if (authSession) {
      session = {
        user: authSession.user,
        tenantId: authSession.tenantId,
        aclVersion: authSession.aclVersion,
        roles: authSession.roles,
      };
    }
  }

  return {
    // infra
    infra: infrastructure,

    // repositories
    repos: repositories,

    // read models
    readModels,

    // services
    services,

    // auth
    session,

    // request abort signal
    reqSignal: opts.req?.signal,

    // metadata
    metadata,
  };
}

export type Context = Awaited<
  ReturnType<typeof createContext>
>;

// ============================================================================
// 🧩 tRPC Init
// ============================================================================

const t = initTRPC
  .context<Context>()
  .create({
    transformer: superjson,

    errorFormatter({
      shape,
      error,
      ctx,
    }) {
      return {
        ...shape,

        data: {
          ...shape.data,

          traceId:
            ctx?.metadata.traceId,

          stack:
            process.env.NODE_ENV ===
            "development"
              ? error.stack
              : undefined,
        },
      };
    },
  });

// ============================================================================
// 🚀 Exports
// ============================================================================

export const router = t.router;

export const publicProcedure =
  t.procedure;

// ============================================================================
// 🛡️ Middlewares
// ============================================================================

// --------------------------------------------------------------------------
// Load Shedding
// --------------------------------------------------------------------------

const loadSheddingGuard =
  t.middleware(async ({ next }) => {
    // TODO:
    // integrate pool pressure metrics

    const isDatabaseSaturated =
      false;

    if (isDatabaseSaturated) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",

        message:
          "SYSTEM_OVERLOADED: Database connection pool is saturated.",
      });
    }

    return next();
  });

// --------------------------------------------------------------------------
// Async Local Storage
// --------------------------------------------------------------------------

const alsMiddleware = t.middleware(
  async ({ ctx, next }) => {
    return requestContextALS.run(
      {
        traceId: ctx.metadata.traceId,

        requestId:
          ctx.metadata.requestId,

        spanId: ctx.metadata.spanId,

        abortSignal: ctx.reqSignal,
      },

      () => next()
    );
  }
);

// --------------------------------------------------------------------------
// Authentication
// --------------------------------------------------------------------------

const isAuthed = t.middleware(
  async ({ ctx, next }) => {
    if (!ctx.session) {
      throw new TRPCError({
        code: "UNAUTHORIZED",

        message:
          "Authentication required.",
      });
    }

    return next({
      ctx: {
        session: ctx.session,
      },
    });
  }
);

// --------------------------------------------------------------------------
// Tenant Isolation
// --------------------------------------------------------------------------

const tenantGuard = t.middleware(
  async ({ ctx, next }) => {
    if (!ctx.session?.tenantId) {
      throw new TRPCError({
        code: "FORBIDDEN",

        message:
          "Tenant isolation failure.",
      });
    }

    return next();
  }
);

// --------------------------------------------------------------------------
// Timeout / Abort
// --------------------------------------------------------------------------

const timeoutGuard = t.middleware(
  async ({ ctx, next }) => {
    const controller =
      new AbortController();

    const onAbort = () => {
      if (!controller.signal.aborted) {
        controller.abort(
          "CLIENT_DISCONNECTED"
        );
      }
    };

    if (ctx.reqSignal) {
      ctx.reqSignal.addEventListener(
        "abort",
        onAbort
      );
    }

    const timeout = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(
          "SERVER_TIMEOUT"
        );
      }
    }, 10000);

    try {
      return await next({
        ctx: {
          ...ctx,

          runtimeAbortSignal:
            controller.signal,
        },
      });
    } finally {
      if (ctx.reqSignal) {
        ctx.reqSignal.removeEventListener(
          "abort",
          onAbort
        );
      }

      clearTimeout(timeout);
    }
  }
);

// --------------------------------------------------------------------------
// Observability
// --------------------------------------------------------------------------

const observabilityMiddleware =
  t.middleware(
    async ({
      path,
      type,
      ctx,
      next,
    }) => {
      const started =
        performance.now();

      try {
        const result = await next();

        ctx.infra.logger.info({
          event:
            "trpc_request_completed",

          path,

          type,

          durationMs: Math.round(
            performance.now() - started
          ),

          traceId:
            ctx.metadata.traceId,

          userId:
            ctx.session?.user?.id,

          tenantId:
            ctx.session?.tenantId,
        });

        return result;
      } catch (error: any) {
        ctx.infra.logger.error({
          event:
            "trpc_request_failed",

          classification: "INTERNAL",

          path,

          type,

          durationMs: Math.round(
            performance.now() - started
          ),

          traceId:
            ctx.metadata.traceId,

          userId:
            ctx.session?.user?.id,

          tenantId:
            ctx.session?.tenantId,

          errorCode:
            error.code || "UNKNOWN",
        });

        throw error;
      }
    }
  );

// ============================================================================
// 🚀 Protected Procedure
// ============================================================================

export const protectedProcedure =
  t.procedure
    .use(loadSheddingGuard)
    .use(alsMiddleware)
    .use(observabilityMiddleware)
    .use(timeoutGuard)
    .use(isAuthed)
    .use(tenantGuard);

// ============================================================================
// 🛡️ Board Membership Guard
// ============================================================================
// Checks that the authenticated user is an active member of the board
// specified in the input. Works with any input shape that has a `boardId` field.
// Adds `boardMembership` to context for downstream role checks.
// ============================================================================

export const boardMemberGuard = t.middleware(
  async ({ ctx, next, rawInput }) => {
    // Extract boardId from input (supports nested and flat shapes)
    const input = rawInput as Record<string, unknown> | null;
    const boardId =
      (input?.boardId as string) ??
      (input?.id as string) ?? // for getFullBoard which uses `id`
      null;

    if (!boardId) {
      // If no boardId in input, skip check (let downstream handle it)
      return next();
    }

    const userId = ctx.session?.user?.id;
    const tenantId = ctx.session?.tenantId;

    if (!userId || !tenantId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required.",
      });
    }

    // Query board_members for active membership
    const membership = await ctx.infra.db.query.boardMembers.findFirst({
      where: and(
        eq(boardMembers.boardId, boardId),
        eq(boardMembers.userId, userId),
        eq(boardMembers.tenantId, tenantId),
        isNull(boardMembers.removedAt),
      ),
    });

    if (!membership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not a member of this board.",
      });
    }

    return next({
      ctx: {
        ...ctx,
        boardMembership: {
          memberId: membership.id,
          role: membership.role as string,
          boardId,
        },
      },
    });
  }
);

// ============================================================================
// 🚀 Board-Protected Procedure
// ============================================================================
// Use this for any procedure that operates on a specific board.
// It extends protectedProcedure with board membership validation.
// After this middleware, ctx.boardMembership is available.
// ============================================================================

export const boardProtectedProcedure =
  t.procedure
    .use(loadSheddingGuard)
    .use(alsMiddleware)
    .use(observabilityMiddleware)
    .use(timeoutGuard)
    .use(isAuthed)
    .use(tenantGuard)
    .use(boardMemberGuard);