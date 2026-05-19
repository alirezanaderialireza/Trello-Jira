import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { AsyncLocalStorage } from "async_hooks";

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

// 🌟 Services
import { BoardService } from "./services/board.service";

// 🔐 Phase 2 — Auth + Multi-Tenancy
import { TokenService }       from "./auth/tokenService";
import { SessionPropagator }  from "./auth/sessionPropagation";
import { MembershipCache }    from "./acl/membershipCache";
import { AuthMiddleware }     from "./middleware/authMiddleware";
import { AuditLogger }        from "./audit/auditLogger";
import { aclEngine }          from "./acl/aclEngine";
import type { PropagatedSession } from "./auth/sessionPropagation";
import type { BoardRole }         from "./acl/aclEngine";

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

// ============================================================================
// 🔐 Phase 2 — Auth Singletons
// ============================================================================

const tokenService = new TokenService(
  process.env.AUTH_PRIVATE_KEY_PEM  ?? _devRsaPrivateKey(),
  process.env.AUTH_PUBLIC_KEY_PEM   ?? _devRsaPublicKey(),
  redisManager.client,
  redisManager.pubsub,
);

const membershipCache = new MembershipCache(
  redisManager.client,
  redisManager.pubsub,
  // Inline adapter — maps to DrizzleBoardRepository which already has tenant-
  // aware queries.  Replace with a dedicated repo in production.
  {
    async getRole(opts) {
      const row = await repositories.board.findMemberRole?.(
        opts.tenantId, opts.boardId, opts.userId,
      ) ?? null;
      return row;
    },
    async getAllForUser(opts) {
      return await repositories.board.findAllMembershipsForUser?.(
        opts.tenantId, opts.userId,
      ) ?? [];
    },
  },
);

const sessionPropagator = new SessionPropagator(
  tokenService,
  membershipCache,
);

const auditLogger = new AuditLogger(
  repositories.audit,
  logger,
);

const authMiddlewareSvc = new AuthMiddleware(
  sessionPropagator,
  membershipCache,
  redisManager.client,
  logger,
);

// ============================================================================
// 🛡️ Session types
// ============================================================================

export type Session = {
  user: {
    id: string;
  };

  tenantId: string;

  aclVersion: number;

  roles: string[];

  // Phase 2 additions
  sid:        string;   // session ID
  jti:        string;   // JWT ID for revocation
  exp:        number;   // expiry epoch seconds
  propagated: PropagatedSession | null;
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

  // Phase 2 — Auth services (stubs; inject real implementations)
  auth: {
    verifyCredentials:  async (_email: string, _password: string) => { throw new Error("Not implemented"); },
    createSession:      async (_opts: any) => { throw new Error("Not implemented"); },
    rotateSession:      async (_opts: any) => { throw new Error("Not implemented"); },
    revokeSession:      async (_opts: any) => { throw new Error("Not implemented"); },
    getPublicKeyJwk:    () => tokenService.getPublicKeyJwk(),
  } as any,

  membershipCache,
  auditLogger,
  authMiddleware: authMiddlewareSvc,
  tokenService,
  aclEngine,

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

  // ── Phase 2: Validate Bearer token from HTTP request ──────────────────────
  // If a session was already extracted upstream (e.g. from an API route that
  // reads the cookie) it is passed directly.  Otherwise we validate the
  // Authorization header here.
  let session = opts.session ?? null;

  if (!session && opts.req) {
    const authorization = opts.req.headers.get("authorization") ?? undefined;
    if (authorization) {
      try {
        const propagated = await sessionPropagator.validateAndPropagate({
          authorization,
          source:    "http",
          ip:        opts.ip,
          userAgent: opts.userAgent,
        });
        session = {
          user:       { id: propagated.userId },
          tenantId:   propagated.tenantId,
          aclVersion: propagated.aclVersion,
          roles:      propagated.roles,
          sid:        propagated.sessionId,
          jti:        propagated.jti,
          exp:        0,   // unknown here; decoded in verifyAccess
          propagated,
        };
      } catch {
        // Leave session null — protectedProcedure will reject if required
      }
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
// ACL Version Drift Detection
// --------------------------------------------------------------------------

const aclVersionGuard = t.middleware(
  async ({ ctx, next }) => {
    // If the session carries a propagated session, re-check ACL drift
    // This is a lightweight check — the membership cache does the heavy lifting
    if (ctx.session?.propagated) {
      const revalidation = await sessionPropagator
        .revalidateForWs(ctx.session.propagated)
        .catch(() => ({ valid: true, aclChanged: false }));

      if (revalidation.aclChanged && revalidation.newRoles) {
        // Refresh roles in context without requiring re-auth
        return next({
          ctx: {
            ...ctx,
            session: ctx.session ? {
              ...ctx.session,
              roles:      revalidation.newRoles,
              aclVersion: revalidation.newAclVersion ?? ctx.session.aclVersion,
            } : ctx.session,
          },
        });
      }
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
    .use(tenantGuard)
    .use(aclVersionGuard);

// ============================================================================
// 🔐 Board-Scoped Procedure (Phase 2)
// ============================================================================
// Extends protectedProcedure with board-level ACL check.
// Procedures using this get ctx.boardRole populated.
//
// Usage:
//   export const myRouter = router({
//     doSomething: boardScopedProcedure
//       .input(z.object({ boardId: z.string().uuid() }))
//       .mutation(async ({ input, ctx }) => {
//         ctx.services.aclEngine.assertBoard(ctx.boardRole!, "UPDATE_CARD");
//         // ...
//       }),
//   });
// ============================================================================

const boardScopeGuard = t.middleware(
  async ({ ctx, rawInput, next }) => {
    const boardId = (rawInput as any)?.boardId as string | undefined;

    if (!boardId || !ctx.session) {
      return next({ ctx: { ...ctx, boardRole: undefined } });
    }

    const boardRole = await membershipCache.getRole(
      ctx.session.tenantId,
      boardId,
      ctx.session.user.id,
    );

    if (boardRole === "NONE") {
      throw new TRPCError({
        code:    "FORBIDDEN",
        message: "Not a member of this board.",
      });
    }

    return next({
      ctx: {
        ...ctx,
        boardRole,
      },
    });
  }
);

export const boardScopedProcedure =
  t.procedure
    .use(loadSheddingGuard)
    .use(alsMiddleware)
    .use(observabilityMiddleware)
    .use(timeoutGuard)
    .use(isAuthed)
    .use(tenantGuard)
    .use(aclVersionGuard)
    .use(boardScopeGuard);

// ============================================================================
// 🔧 Dev helpers — generate temporary RSA key pair for local development
// ============================================================================
// In production these are read from AWS Secrets Manager / Vault / env vars.

function _devRsaPrivateKey(): string {
  // Placeholder — in dev, generate with: openssl genrsa -out private.pem 2048
  return process.env.AUTH_PRIVATE_KEY_PEM ?? "DEV_PRIVATE_KEY_NOT_SET";
}

function _devRsaPublicKey(): string {
  return process.env.AUTH_PUBLIC_KEY_PEM ?? "DEV_PUBLIC_KEY_NOT_SET";
}