import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { AsyncLocalStorage } from "async_hooks";

// 📦 Auth
import { getSessionFromRequest, type AuthSession } from "@repo/auth";

// 📦 Database
import { db, withTenantContext, applyTenantContextFromALS } from "@repo/db";

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
  boards,
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
import { CreateListHandler, MoveListHandler } from "@repo/domain";

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

// ─────────────────────────────────────────────────────────────────────────────
// `applyTenantContextFromALS` reads tenantId / userId from the per-request
// `tenantContextALS` slot (set by `withTenantContext` and the
// `tenantContextMiddleware` below) and runs `SET LOCAL app.current_tenant_id`
// on the supplied transaction. Wiring it into the txManager is what makes
// service-driven transactions (e.g. `BoardService.moveCard`) RLS-correct
// without any per-service changes — the manager opens its own connection
// from the pool, sets the GUC, then runs the user callback.
//
// We wrap the helper in an arrow that discards its boolean return value:
// the helper returns whether the GUC was actually applied, but
// `TransactionManager.applyTenantContext` is typed as `Promise<void>`. The
// boolean is only useful to direct callers who want to branch on
// "no tenant context in scope"; the txManager doesn't.
// ─────────────────────────────────────────────────────────────────────────────
const txManager = new TransactionManager(
  dbInstance,
  async (tx) => {
    await applyTenantContextFromALS(tx);
  }
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

const boardService = new BoardService(
  txManager,

  repositories.card,

  repositories.list,

  repositories.outbox,

  repositories.idempotency,

  repositories.audit,

  repositories.sequence,

  lockManager,

  logger,
);

const services = Object.freeze({
  board: boardService,

  commands: {
    // =========================================================================
    // ✅ Domain handlers (use-case driven, live in @repo/domain)
    // =========================================================================

    createList: new CreateListHandler(
      txManager,

      repositories.list,

      repositories.board,

      repositories.outbox,

      repositories.sequence,

      logger,
    ),

    moveList: new MoveListHandler(
      txManager,

      repositories.list,

      repositories.outbox,

      repositories.sequence,

      logger,
    ),

    // =========================================================================
    // ✅ Adapter handlers — delegate to BoardService methods which already
    // contain the rich command pipeline (idempotency, audit, outbox, sequence
    // bump, ACL load, OCC). Each adapter exposes an `.execute()` method so the
    // tRPC routers (cardRouter / boardRouter) can call them uniformly with the
    // same shape as the dedicated CreateListHandler / MoveListHandler.
    //
    // Result contract for createCard / updateCard / deleteCard:
    //   { success: true, cardId, listRevision, boardSequence, projectionSequence, aclVersion }
    //   | { success: false, reason: DomainErrorReason }
    //
    // Result contract for updateList / deleteList:
    //   { success: true, listId, boardSequence, projectionSequence, aclVersion }
    //   | { success: false, reason: DomainErrorReason }
    // =========================================================================

    createCard: {
      execute: (cmd: Parameters<typeof boardService.createCard>[0]) =>
        boardService.createCard(cmd),
    },

    updateCard: {
      execute: (cmd: Parameters<typeof boardService.updateCard>[0]) =>
        boardService.updateCard(cmd),
    },

    deleteCard: {
      execute: (cmd: Parameters<typeof boardService.deleteCard>[0]) =>
        boardService.deleteCard(cmd),
    },

    updateList: {
      execute: (cmd: Parameters<typeof boardService.updateList>[0]) =>
        boardService.updateList(cmd),
    },

    deleteList: {
      execute: (cmd: Parameters<typeof boardService.deleteList>[0]) =>
        boardService.deleteList(cmd),
    },
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
  // Priority: explicit opts.session > extract from request (cookie/header) > null
  // Note: Auth.js sets a session cookie that getSessionFromRequest can read.
  // The tenantId/workspaceId is resolved per-procedure from input, not from session.
  let session: Session | null = opts.session ?? null;

  if (!session && opts.req) {
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

    // ──────────────────────────────────────────────────────────────────────
    // 🛡️ RLS-aware transaction runner.
    //
    // Procedures that read or write tenant-scoped tables MUST execute their
    // queries inside this helper so that PostgreSQL's RLS policies see a
    // populated `app.current_tenant_id` GUC. The session/tenant guard
    // middleware enforces a non-null session before reaching here.
    //
    // Usage in a protected procedure:
    //
    //   const labels = await ctx.runInTenantTx(async (tx) =>
    //     tx.query.labels.findMany({ where: eq(labels.boardId, input.boardId) })
    //   );
    //
    // For procedures that delegate to a service (e.g. boardService.moveCard)
    // the service's own TransactionManager is expected to surface the GUC
    // setter via setTenantContextOnTx(tx, …). This is the migration path —
    // existing services keep working until they are individually rewritten.
    // ──────────────────────────────────────────────────────────────────────
    runInTenantTx: <T>(cb: (tx: any) => Promise<T>): Promise<T> => {
      if (!session?.tenantId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Tenant context unavailable.",
        });
      }
      return withTenantContext(
        dbInstance,
        { tenantId: session.tenantId, userId: session.user.id },
        cb,
      );
    },
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
// 🛡️ RLS Tenant Context Middleware  (THE THIRD DEFENCE LAYER)
// --------------------------------------------------------------------------
// Opens a database transaction, sets the `app.current_tenant_id` and
// `app.current_user_id` GUC variables (which the PostgreSQL RLS policies
// from migration 0002 read), and exposes the transaction handle to the
// procedure as both `ctx.tx` AND `ctx.infra.db`.
//
// WHY WE REPLACE `ctx.infra.db`:
//   Most existing routers query `ctx.infra.db.query.X.find*(...)` directly.
//   A previous version of this middleware kept the original `infra.db`
//   intact and only added `ctx.tx`, which forced every router to be
//   rewritten to opt in. The result: the routers never opted in, RLS was
//   enabled on the tables, and every tenant-scoped read returned EMPTY
//   silently because the GUC was never set.
//
//   Replacing `ctx.infra.db` with the transaction handle makes RLS the
//   default — existing routers transparently become RLS-correct without
//   touching their query code. The tx handle exposes the same
//   `query.X`, `select()`, `insert()`, `update()`, `delete()`,
//   `execute()` API as the top-level db.
//
// SERVICE-LEVEL TRANSACTIONS:
//   Domain services (BoardService, list/card command handlers) open their
//   own transactions via `txManager.serializable(...)`. That manager has
//   been wired (above, in the `txManager` constructor) to read from
//   `tenantContextALS` and run `SET LOCAL app.current_tenant_id = ...`
//   on every transaction it opens — so service-driven queries inherit
//   the same RLS context without any per-service code changes.
//
// FAIL-CLOSED:
//   `ctx.runInTenantTx` throws FORBIDDEN when `session.tenantId` is
//   missing. Combined with the `tenantGuard` middleware that runs first,
//   this middleware can rely on a non-null tenantId.
// --------------------------------------------------------------------------

const tenantContextMiddleware = t.middleware(
  async ({ ctx, next }) => {
    if (!ctx.session?.tenantId) {
      // Should be caught by tenantGuard, but defensive.
      return next();
    }

    return ctx.runInTenantTx(async (tx) => {
      // ──────────────────────────────────────────────────────────────────
      // Per-request board → workspace cache (F2 D4).
      //
      // `boardId → tenantId/workspaceId` is a topology fact that cannot
      // change at runtime — a board never moves tenants. A single request
      // that needs the mapping more than once (e.g. a router which calls
      // an admin assertion twice, or a F2 builder that loads board info
      // before delegating to a service) should pay one DB round-trip,
      // not N. Redis is overkill for an immutable value with sub-request
      // lifetime; a Map dies with the request and never goes stale.
      //
      // The map and the helper close over the active transaction `tx`,
      // so the lookup runs inside the same RLS-enforced tx as the rest
      // of the procedure. A missing board surfaces as NOT_FOUND
      // (Persian message for the user; English code for the dev tools).
      // ──────────────────────────────────────────────────────────────────
      const boardWorkspaceCache = new Map<string, string>();

      const resolveBoardWorkspaceId = async (
        boardId: string,
      ): Promise<string> => {
        const cached = boardWorkspaceCache.get(boardId);
        if (cached !== undefined) return cached;

        const row = await tx.query.boards.findFirst({
          where: eq(boards.id, boardId),
        });
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "بورد یافت نشد.",
          });
        }
        boardWorkspaceCache.set(boardId, row.tenantId);
        return row.tenantId;
      };

      return next({
        ctx: {
          ...ctx,
          // Transparent RLS: redirect every direct `ctx.infra.db.*` call
          // through the transaction whose GUC is set. Unfreeze with a
          // shallow clone — `infrastructure` is `Object.freeze`d at module
          // load.
          infra: { ...ctx.infra, db: tx },
          // Also expose `tx` directly for procedures that explicitly want
          // to be RLS-aware in their type signature.
          tx,
          // Per-request board → workspace mapping. Procedures (especially
          // F2 builders that need to assert workspace membership of a
          // board's tenant) should call this helper instead of running a
          // fresh boards lookup each time.
          resolveBoardWorkspaceId,
        },
      });
    });
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
// 🚀 Protected Procedure  (RLS-enforcing by default)
// ============================================================================
//
// The full pipeline:
//
//   loadShedding → ALS → observability → timeout → auth → tenantGuard
//   → tenantContextMiddleware (opens tx, SET LOCAL GUC, swaps infra.db)
//
// Every router that uses `protectedProcedure` therefore runs inside a
// transaction whose `app.current_tenant_id` GUC matches the request's
// session tenant — Postgres RLS policies (migration 0002 + 0004) enforce
// the same boundary even if a router has a bug or a SQL injection
// reaches the database.
//
// Trade-offs:
//   • Every protected request now opens a DB transaction. Read-only
//     handlers pay an extra round-trip; in production we'll want
//     read-only Postgres transactions (`db.transaction({ accessMode:
//     'read only' })`) for hot read paths. Acceptable cost for the
//     correctness guarantee at this stage.
//   • Streaming / subscription procedures should NOT use
//     `protectedProcedure` because the transaction would stay open for
//     the whole subscription. Use `publicProcedure` + manual auth/RLS
//     wiring there.
// ============================================================================

export const protectedProcedure =
  t.procedure
    .use(loadSheddingGuard)
    .use(alsMiddleware)
    .use(observabilityMiddleware)
    .use(timeoutGuard)
    .use(isAuthed)
    .use(tenantGuard)
    .use(tenantContextMiddleware);

// ============================================================================
// 🚀 Tenant-Tx Procedure  (DEPRECATED ALIAS)
// ============================================================================
//
// Historically this procedure was the only RLS-enforced one. Now that
// `protectedProcedure` itself enforces RLS, `tenantTxProcedure` is just an
// alias kept for source compatibility. New code should use
// `protectedProcedure`.
// ============================================================================

export const tenantTxProcedure = protectedProcedure;

// ============================================================================
// 🛡️ Board Membership Guard
// ============================================================================
// Checks that the authenticated user is an active member of the board
// specified in the input. Works with any input shape that has a `boardId` field.
// Adds `boardMembership` to context for downstream role checks.
// ============================================================================

export const boardMemberGuard = t.middleware(
  async ({ ctx, next, getRawInput }) => {
    // Extract boardId from input (supports nested and flat shapes)
    // tRPC v11: rawInput is now an async getter (`getRawInput`).
    const rawInput = await getRawInput();
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
// It extends `protectedProcedure` with board membership validation.
// After this middleware, `ctx.boardMembership` is available.
//
// Important ordering note: `tenantContextMiddleware` runs BEFORE
// `boardMemberGuard` so the membership lookup happens inside the same
// RLS-enforced transaction. The board_members query is then bound by the
// same `app.current_tenant_id` GUC as the rest of the procedure.
// ============================================================================

export const boardProtectedProcedure =
  t.procedure
    .use(loadSheddingGuard)
    .use(alsMiddleware)
    .use(observabilityMiddleware)
    .use(timeoutGuard)
    .use(isAuthed)
    .use(tenantGuard)
    .use(tenantContextMiddleware)
    .use(boardMemberGuard);

// ============================================================================
// 🚀 F2 — Authorization-aware Procedure Re-exports
// ============================================================================
//
// These builders live in `./middleware/` and compose with the
// `protectedProcedure` / `boardProtectedProcedure` defined above. Re-exporting
// them here gives F3 routers a single import surface — `import {
// workspaceMemberProcedure, boardAdminProcedure, ... } from "../trpc"` —
// which mirrors the existing convention for `protectedProcedure` and keeps
// the per-router import block one line.
//
// The circular shape (trpc.ts ↔ middleware/*) is benign here because the
// re-export sits at the bottom of the file, AFTER every procedure builder
// it depends on has been evaluated. ES module live-binding then resolves
// the import in `middleware/*` at evaluation time without surprise.
// ============================================================================

export {
  loadWorkspaceMembership,
  requireWorkspaceManagerRole,
  requireWorkspaceOwnerRole,
  workspaceMemberProcedure,
  workspaceAdminProcedure,
  workspaceOwnerProcedure,
} from "./middleware/workspaceRoleProcedures";

export type { WorkspaceMembershipContext } from "./middleware/workspaceRoleProcedures";

export {
  requireBoardManagerRole,
  boardMemberProcedure,
  boardAdminProcedure,
} from "./middleware/boardRoleProcedures";

export {
  assertWorkspaceWritable,
  assertBoardWritable,
  workspaceAdminWriteProcedure,
  boardAdminWriteProcedure,
  makeBoardAdminWriteProcedure,
} from "./middleware/writeProcedures";