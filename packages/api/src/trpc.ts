import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { AsyncLocalStorage } from "async_hooks";
import { z } from "zod";

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
} from "@repo/db";

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

// 🌟 ACL Engine + Membership Cache
import { AclEngine } from "@repo/infrastructure/auth/aclEngine";
import { MembershipCache } from "@repo/infrastructure/redis/membershipCache";
import type { BoardPermission } from "@repo/infrastructure/auth/aclEngine";

// 🌟 Audit Logger
import { AuditLogger } from "@repo/infrastructure/audit/auditLogger";

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

// 🌟 ACL + Membership Cache + Audit
const aclEngine = new AclEngine(dbInstance, redisManager.client);
const membershipCache = new MembershipCache(
  redisManager.client,
  redisManager.pubsub, // dedicated sub connection
  dbInstance,
);
const auditLogger = new AuditLogger(dbInstance, redisManager.client);

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

  aclEngine,

  membershipCache,

  auditLogger,
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
    session: opts.session ?? null,

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
// 🛡️ boardScopedProcedure
// ----------------------------------------------------------------------------
// Used for ALL board, list, and card mutations.
// Requires `boardId` in input (validated as UUID).
// Injects `boardRole` and `boardAclVersion` into context for downstream use.
// Rejects if user has NONE role (not a member of the board).
// ============================================================================

/**
 * ACL middleware factory — accepts the permission to enforce.
 * Usage:
 *   export const boardScopedProcedure = makeBoardScopedProcedure("card:create");
 */
export function makeBoardScopedProcedure(permission: BoardPermission) {
  return protectedProcedure
    .input(z.object({ boardId: z.string().uuid() }).passthrough())
    .use(async ({ ctx, input, next }) => {
      const { boardId } = input as { boardId: string };
      const { userId, tenantId } = ctx.session;

      const aclResult = await ctx.infra.aclEngine.check({
        userId,
        tenantId,
        boardId,
        permission,
        expectedAclVersion: (input as any).expectedAclVersion,
      });

      if (!aclResult.allowed) {
        ctx.infra.logger.warn({
          event: "acl_check_denied",
          classification: "SENSITIVE",
          userId,
          tenantId,
          boardId,
          permission,
          role: aclResult.role,
          aclVersion: aclResult.aclVersion,
          traceId: ctx.metadata.traceId,
        });

        throw new TRPCError({
          code:
            aclResult.role === "NONE" ? "FORBIDDEN" : "FORBIDDEN",
          message: "Insufficient board permissions.",
        });
      }

      return next({
        ctx: {
          ...ctx,
          boardRole: aclResult.role,
          boardAclVersion: aclResult.aclVersion,
        },
      });
    });
}

// ============================================================================
// 🛡️ aclVersionGuard middleware
// ----------------------------------------------------------------------------
// Standalone middleware that checks if the client's aclVersion matches the
// current board aclVersion. Attach to any procedure that is sensitive to
// permission drift (e.g., moveCard, deleteCard).
// ============================================================================

export const aclVersionGuard = t.middleware(
  async ({ ctx, input, next }) => {
    const inp = input as {
      boardId?: string;
      expectedAclVersion?: number;
    } | null;

    if (!inp?.boardId || inp.expectedAclVersion === undefined) {
      // Guard is a no-op if not provided — callers opt-in
      return next();
    }

    const aclResult = await ctx.infra.aclEngine.check({
      userId: ctx.session!.userId ?? ctx.session!.user.id,
      tenantId: ctx.session!.tenantId,
      boardId: inp.boardId,
      permission: "board:read", // cheapest check — only validates aclVersion
      expectedAclVersion: inp.expectedAclVersion,
    });

    if (!aclResult.allowed) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "ACL version mismatch — permissions changed.",
      });
    }

    return next();
  }
);