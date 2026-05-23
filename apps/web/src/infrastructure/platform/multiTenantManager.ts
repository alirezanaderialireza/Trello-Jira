// apps/web/src/infrastructure/platform/multiTenantManager.ts
// Tenant isolation + context propagation for multi-tenant boards.

import { telemetry } from "@/lib/telemetry/logEvent";

export interface TenantContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: "owner" | "admin" | "member" | "guest";
  readonly boardIds: readonly string[];
  readonly serviceIdentity?: string;
}

export class MultiTenantManager {
  private context: TenantContext | null = null;

  setContext(ctx: TenantContext): void {
    this.context = ctx;
    telemetry.log("STORE", "TENANT_CONTEXT_SET", { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role });
  }

  getContext(): TenantContext | null { return this.context; }
  clearContext(): void { this.context = null; }

  /** Validates that an operation is scoped to the current tenant. */
  validateTenantAccess(resourceTenantId: string): boolean {
    if (!this.context) return false;
    return this.context.tenantId === resourceTenantId;
  }

  /** Validates that the current user has access to the given board. */
  validateBoardAccess(boardId: string): boolean {
    if (!this.context) return false;
    return this.context.boardIds.includes(boardId);
  }

  /** Returns headers for service-to-service calls with tenant context. */
  getServiceHeaders(): Record<string, string> {
    if (!this.context) return {};
    return {
      "x-tenant-id": this.context.tenantId,
      "x-user-id": this.context.userId,
      "x-user-role": this.context.role,
      ...(this.context.serviceIdentity ? { "x-service-identity": this.context.serviceIdentity } : {}),
    };
  }
}

export const multiTenantManager = new MultiTenantManager();
