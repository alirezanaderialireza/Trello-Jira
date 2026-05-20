// packages/domain/src/shared/workspaceId.ts
// Alias: workspaceId = tenantId — for gradual migration.
// All new code should use WorkspaceId. Legacy code uses TenantId.
// Both are the same branded type for now.

import type { TenantId } from "./ids";

/**
 * WorkspaceId — alias for TenantId during migration period.
 * In the DB, this maps to `boards.tenant_id` which FK references `workspaces.id`.
 * After full migration, TenantId will be deprecated.
 */
export type WorkspaceId = TenantId & { readonly __workspaceAlias?: true };

/**
 * Cast a TenantId to WorkspaceId (zero-cost at runtime).
 */
export function asWorkspaceId(tenantId: TenantId): WorkspaceId {
  return tenantId as WorkspaceId;
}

/**
 * Cast a WorkspaceId back to TenantId for legacy APIs.
 */
export function asTenantId(workspaceId: WorkspaceId): TenantId {
  return workspaceId as TenantId;
}
