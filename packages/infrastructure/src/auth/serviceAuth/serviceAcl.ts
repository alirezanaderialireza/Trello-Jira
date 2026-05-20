// packages/infrastructure/src/auth/serviceAuth/serviceAcl.ts
// ─────────────────────────────────────────────────────────────────────────────
// Service ACL — defines and enforces which service can perform which actions.
//
// Registry pattern: each service is registered with its allowed scopes.
// The InternalAuthMiddleware calls serviceAcl.enforce() before allowing
// any internal request to proceed.
//
// Scope format: "<domain>:<action>"
//   events:publish       — publish domain events to outbox/WS
//   events:subscribe     — subscribe to WS event streams
//   replay:read          — read event journal for replay
//   replay:write         — trigger projection rebuild
//   cleanup:sessions     — GC expired sessions
//   cleanup:idempotency  — GC stale idempotency keys
//   boards:read          — read board projections
//   boards:write         — mutate boards
//   auth:revoke          — revoke sessions / tokens
//   audit:read           — read audit logs
// ─────────────────────────────────────────────────────────────────────────────

import type { ServiceName, ServiceTokenClaims } from "./serviceTokenService";
import { ServiceAuthError } from "./serviceTokenService";

// ============================================================================
// Types
// ============================================================================

export type ServiceScope =
  | "events:publish"
  | "events:subscribe"
  | "replay:read"
  | "replay:write"
  | "cleanup:sessions"
  | "cleanup:idempotency"
  | "boards:read"
  | "boards:write"
  | "auth:revoke"
  | "audit:read";

export interface ServiceRegistration {
  name:        ServiceName;
  scopes:      ServiceScope[];
  description: string;
}

// ============================================================================
// Default Service Registry
// ============================================================================

const DEFAULT_REGISTRY: ServiceRegistration[] = [
  {
    name: "worker",
    scopes: [
      "events:publish",
      "replay:read",
      "replay:write",
      "cleanup:sessions",
      "cleanup:idempotency",
      "auth:revoke",
    ],
    description: "Background worker — outbox processing, GC, replay",
  },
  {
    name: "realtime",
    scopes: [
      "events:subscribe",
      "events:publish",
      "auth:revoke",
    ],
    description: "WebSocket gateway — event fanout, presence",
  },
  {
    name: "scheduler",
    scopes: [
      "cleanup:sessions",
      "cleanup:idempotency",
      "replay:write",
    ],
    description: "Cron / scheduled jobs",
  },
  {
    name: "web",
    scopes: [
      "boards:read",
      "boards:write",
      "events:publish",
      "audit:read",
    ],
    description: "Next.js web application — tRPC endpoints",
  },
  {
    name: "api",
    scopes: [
      "boards:read",
      "boards:write",
      "events:publish",
      "replay:read",
      "auth:revoke",
      "audit:read",
    ],
    description: "API server — all board operations",
  },
];

// ============================================================================
// ServiceAcl
// ============================================================================

export class ServiceAcl {
  private readonly registry = new Map<string, ServiceRegistration>();

  constructor(registrations?: ServiceRegistration[]) {
    for (const reg of registrations ?? DEFAULT_REGISTRY) {
      this.registry.set(reg.name, reg);
    }
  }

  /** Register or update a service's allowed scopes */
  register(registration: ServiceRegistration): void {
    this.registry.set(registration.name, registration);
  }

  /** Get registration for a service */
  getRegistration(name: ServiceName): ServiceRegistration | null {
    return this.registry.get(name) ?? null;
  }

  /** Get all registrations (for admin / devtools) */
  getAll(): ServiceRegistration[] {
    return [...this.registry.values()];
  }

  // ==========================================================================
  // Enforce: check that the calling service has the required scope
  // ==========================================================================

  enforce(claims: ServiceTokenClaims, requiredScope: ServiceScope): void {
    const serviceName = claims.sub.replace("service:", "") as ServiceName;
    const registration = this.registry.get(serviceName);

    if (!registration) {
      throw new ServiceAuthError(
        "SERVICE_NOT_REGISTERED",
        `Service "${serviceName}" is not registered in the ACL registry`,
      );
    }

    // Check token's scope claim contains the required scope
    if (!claims.scope.includes(requiredScope)) {
      throw new ServiceAuthError(
        "SCOPE_DENIED",
        `Service "${serviceName}" lacks scope "${requiredScope}". ` +
          `Granted: [${claims.scope.join(", ")}]`,
      );
    }

    // Double-check against registry (defense in depth — token may have stale scopes)
    if (!registration.scopes.includes(requiredScope)) {
      throw new ServiceAuthError(
        "SCOPE_DENIED",
        `Service "${serviceName}" registry does not allow scope "${requiredScope}"`,
      );
    }
  }

  // ==========================================================================
  // Check (non-throwing variant — returns boolean)
  // ==========================================================================

  check(claims: ServiceTokenClaims, requiredScope: ServiceScope): boolean {
    try {
      this.enforce(claims, requiredScope);
      return true;
    } catch {
      return false;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: ServiceAcl | null = null;
export function getServiceAcl(): ServiceAcl {
  if (!_instance) _instance = new ServiceAcl();
  return _instance;
}
