import { router } from "./trpc";
export { createContext } from "./trpc";
// 📦 Domains
import { boardRouter } from "./routers/board";
import { boardManagementRouter } from "./routers/board-management";
import { boardMembersRouter } from "./routers/board-members";
import { listRouter } from "./routers/list";
import { cardRouter } from "./routers/card";

// 🃏 Card Features (Phase 4 — Rich Card)
import { labelsRouter } from "./routers/card-features/labels.router";
import { checklistsRouter } from "./routers/card-features/checklists.router";
import { commentsRouter } from "./routers/card-features/comments.router";
import { dueDateRouter } from "./routers/card-features/due-date.router";
import { activityRouter } from "./routers/card-features/activity.router";

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
    // 🌍 PUBLIC BOUNDARY
    // ------------------------------------------------------------------------
    public: router({
      board: boardRouter,
      boardManagement: boardManagementRouter,
      boardMembers: boardMembersRouter,
      list: listRouter,
      card: cardRouter,
      // 🃏 Rich Card Features
      label: labelsRouter,
      checklist: checklistsRouter,
      comment: commentsRouter,
      dueDate: dueDateRouter,
      activity: activityRouter,
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
