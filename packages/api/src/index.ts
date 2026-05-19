import { router } from "./trpc";
export { createContext } from "./trpc";
// 📦 Domains
import { boardRouter } from "./routers/board";
import { listRouter } from "./routers/list";
import { cardRouter } from "./routers/card";

// 🔐 Auth (Phase 2)
import { authRouter } from "./routers/auth.router";

// ⚡ Realtime & Sync
import { realtimeSyncRouter } from "./routers/realtime/sync.router";
import { presenceRouter } from "./routers/realtime/presence.router";

// 🛠️ Internal & Ops
import { opsRouter } from "./routers/system/ops.router";
import { jobsRouter } from "./routers/system/jobs.router";
import { webhookRouter } from "./routers/internal/webhooks";

// ============================================================================
// 🚀 THE ENTERPRISE ROOT ROUTER
// ============================================================================

export const appRouter = router({
  v1: router({

    // ------------------------------------------------------------------------
    // 🔐 AUTH BOUNDARY (Phase 2)
    // ------------------------------------------------------------------------
    auth: authRouter,

    // ------------------------------------------------------------------------
    // 🌍 PUBLIC BOUNDARY
    // ------------------------------------------------------------------------
    public: router({
      board: boardRouter,
      list: listRouter,
      card: cardRouter,
    }),

    // ------------------------------------------------------------------------
    // ⚡ REALTIME BOUNDARY
    // ------------------------------------------------------------------------
    realtime: router({
      sync: realtimeSyncRouter,
      presence: presenceRouter,
    }),

    // ------------------------------------------------------------------------
    // 🔒 INTERNAL BOUNDARY
    // ------------------------------------------------------------------------
    internal: router({
      webhooks: webhookRouter,
    }),

    // ------------------------------------------------------------------------
    // 🛠️ SYSTEM & OPS BOUNDARY
    // ------------------------------------------------------------------------
    system: router({
      ops: opsRouter,
      jobs: jobsRouter,
    }),

  }),
});

export type AppRouter = typeof appRouter;