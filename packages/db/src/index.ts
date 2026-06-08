// packages/db/src/index.ts

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// ============================================================================
// 🌟 1. Import Schemas (Domain & Infrastructure)
// ============================================================================
import * as schema from "./schema"; // تمام جداول: cards, lists, boards, boardMembers, outboxEvents, idempotencyKeys, auditLogs, boardSequences

// ============================================================================
// 🌟 2. Import Repositories & Projections
// ============================================================================
import { DrizzleCardRepository } from "./repositories/card.repository";
import { DrizzleListRepository } from "./repositories/list.repository";
import { DrizzleBoardRepository } from "./repositories/board.repository";
import { DrizzleOutboxRepository } from "./repositories/outbox.repository";
import { DrizzleAuditRepository } from "./repositories/audit.repository";
import { DrizzleIdempotencyRepository } from "./repositories/idempotency.repository";
import { DrizzleSequenceRepository } from "./repositories/sequence.repository";
import { DrizzleWorkspaceRepository } from "./repositories/workspaces.repository";
import { DrizzleWorkspaceInvitationsRepository } from "./repositories/workspaceInvitations.repository";
import { DrizzleUserBoardMetadataRepository } from "./repositories/userBoardMetadata.repository";
import { DrizzleLabelsRepository } from "./repositories/labels.repository";
import { DrizzleChecklistsRepository } from "./repositories/checklists.repository";
import { DrizzleCommentsRepository } from "./repositories/comments.repository";
import { DrizzleCardAssigneesRepository } from "./repositories/cardAssignees.repository";
import { BoardReadModels } from "./projections/board.read-models";

// ============================================================================
// 🛡️ Safe Connection Pooling (Serverless & HMR Safe)
// ============================================================================
if (!process.env.DATABASE_URL) {
  throw new Error("❌ DATABASE_URL environment variable is missing.");
}

const globalForDb = globalThis as unknown as { conn: postgres.Sql | undefined };

const poolMax =
  process.env.DB_MAX_CONNECTIONS
    ? parseInt(process.env.DB_MAX_CONNECTIONS, 10)
    : process.env.NODE_ENV === "production"
    ? 10
    : 1;

const sqlClient = globalForDb.conn ?? postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: poolMax,
  idle_timeout: 20,
});

if (process.env.NODE_ENV !== "production") {
  globalForDb.conn = sqlClient;
}

// 🌟 تزریق مستقیم اسکیماها به Drizzle
export const db = drizzle(sqlClient, { schema });
export type Database = typeof db;

// ============================================================================
// 🌟 3. Export Repository Singletons
// ============================================================================
export const cardRepo = new DrizzleCardRepository(db);
export const listRepo = new DrizzleListRepository(db);
export const boardRepo = new DrizzleBoardRepository(db);
export const boardReadModels = new BoardReadModels(db);

export const outboxRepo = new DrizzleOutboxRepository(db);
export const auditRepo = new DrizzleAuditRepository(db);
export const idempotencyRepo = new DrizzleIdempotencyRepository(db);
export const sequenceRepo = new DrizzleSequenceRepository(db);
export const workspaceRepo = new DrizzleWorkspaceRepository(db);
export const labelsRepo = new DrizzleLabelsRepository(db);
export const checklistsRepo = new DrizzleChecklistsRepository(db);
export const commentsRepo = new DrizzleCommentsRepository(db);
export const cardAssigneesRepo = new DrizzleCardAssigneesRepository(db);

// ============================================================================
// 🌟 4. Export Repository Classes (Type Usage)
// ============================================================================
export {
  DrizzleCardRepository,
  DrizzleListRepository,
  DrizzleBoardRepository,
  DrizzleOutboxRepository,
  DrizzleAuditRepository,
  DrizzleIdempotencyRepository,
  DrizzleSequenceRepository,
  DrizzleWorkspaceRepository,
  DrizzleWorkspaceInvitationsRepository,
  DrizzleUserBoardMetadataRepository,
  DrizzleLabelsRepository,
  DrizzleChecklistsRepository,
  DrizzleCommentsRepository,
  DrizzleCardAssigneesRepository,
  BoardReadModels,
};

// F3a.3 invitation repository errors
export { DuplicateActiveInvitationError, TokenGenerationExhaustedError } from "./repositories/workspaceInvitations.repository";

// F3b sidebar projection types
export type { SidebarBoardLink } from "./repositories/userBoardMetadata.repository";

// F3a.1 read-side projection types
export type { WorkspaceListItem, WorkspaceDetail, WorkspaceMemberWithUser } from "./repositories/workspaces.repository";

// ============================================================================
// 🌟 5. Re-Exports Schemas (برای دسترسی سایر لایه‌ها به تایپ‌ها و جدول‌ها)
// ============================================================================
export * from "./schema";

// ============================================================================
// 🌟 6. Tenant Context Middleware (RLS GUC setter)
// ============================================================================
export {
  withTenantContext,
  setTenantContextOnTx,
  verifyTenantContext,
  applyTenantContextFromALS,
  getCurrentTenantContext,
  tenantContextALS,
  type TenantContextParams,
} from "./middleware/tenantContext";