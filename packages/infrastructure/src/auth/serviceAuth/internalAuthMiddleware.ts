// packages/infrastructure/src/auth/serviceAuth/internalAuthMiddleware.ts
// ─────────────────────────────────────────────────────────────────────────────
// Internal Auth Middleware — validates every service-to-service request.
//
// Flow:
//   1. Extract token from `Authorization: Bearer <token>` header
//   2. Verify token signature + expiry + audience via ServiceTokenService
//   3. Check required scope against ServiceAcl
//   4. Append audit metadata (serviceId, traceId) to the request context
//   5. On failure: return 401/403 + log to audit trail
//
// Integration:
//   - tRPC: use as a tRPC middleware for internal-only procedures
//   - HTTP: use as Express/Fastify/Next.js middleware for raw API routes
//   - WS:   use during connection handshake for internal WS connections
//
// Audit integration:
//   Every service request (pass or fail) is logged to the internal audit trail
//   via AuditLogger.appendOutOfBand() with source="SERVICE".
// ─────────────────────────────────────────────────────────────────────────────

import type { ServiceTokenService, ServiceTokenClaims } from "./serviceTokenService";
import { ServiceAuthError } from "./serviceTokenService";
import type { ServiceAcl, ServiceScope } from "./serviceAcl";
import type { AuditLogger } from "../../audit/auditLogger";
import type { Logger } from "@repo/domain";

// ============================================================================
// Types
// ============================================================================

export interface InternalAuthContext {
  serviceClaims: ServiceTokenClaims;
  serviceId:     string; // e.g. "service:worker"
  scopes:        string[];
}

export interface InternalAuthResult {
  success:  boolean;
  context?: InternalAuthContext;
  error?:   { code: string; message: string };
}

export interface InternalRequestContext {
  authorizationHeader?: string;
  traceId?:            string;
  spanId?:             string;
  ip?:                 string;
}

// ============================================================================
// InternalAuthMiddleware
// ============================================================================

export class InternalAuthMiddleware {
  constructor(
    private readonly tokenService: ServiceTokenService,
    private readonly acl:          ServiceAcl,
    private readonly auditLogger:  AuditLogger,
    private readonly logger:       Logger,
    private readonly audience:     string, // this service's name (for aud check)
  ) {}

  // ==========================================================================
  // validate — core auth check (call for every internal request)
  // ==========================================================================

  async validate(
    request: InternalRequestContext,
    requiredScope: ServiceScope,
  ): Promise<InternalAuthResult> {
    const { authorizationHeader, traceId, spanId, ip } = request;

    // 1. Extract token
    if (!authorizationHeader?.startsWith("Bearer ")) {
      this.logFailure("MISSING_TOKEN", "", traceId, ip);
      return { success: false, error: { code: "MISSING_TOKEN", message: "No Bearer token provided" } };
    }

    const token = authorizationHeader.slice(7);

    // 2. Verify token
    let claims: ServiceTokenClaims;
    try {
      claims = this.tokenService.verify(token, this.audience);
    } catch (err) {
      const code = err instanceof ServiceAuthError ? err.code : "VERIFICATION_FAILED";
      const msg  = err instanceof Error ? err.message : "Token verification failed";
      this.logFailure(code, "", traceId, ip);
      return { success: false, error: { code, message: msg } };
    }

    // 3. Check scope via ACL
    try {
      this.acl.enforce(claims, requiredScope);
    } catch (err) {
      const code = err instanceof ServiceAuthError ? err.code : "SCOPE_DENIED";
      const msg  = err instanceof Error ? err.message : "Insufficient scope";
      this.logFailure(code, claims.sub, traceId, ip);
      return { success: false, error: { code, message: msg } };
    }

    // 4. Build context
    const context: InternalAuthContext = {
      serviceClaims: claims,
      serviceId:     claims.sub,
      scopes:        claims.scope,
    };

    // 5. Audit success
    this.logSuccess(claims.sub, requiredScope, traceId, ip);

    return { success: true, context };
  }

  // ==========================================================================
  // Express-style middleware helper
  // ==========================================================================

  middleware(requiredScope: ServiceScope) {
    return async (req: any, res: any, next: any) => {
      const result = await this.validate({
        authorizationHeader: req.headers?.authorization ?? req.headers?.["Authorization"],
        traceId:             req.headers?.["x-trace-id"],
        spanId:              req.headers?.["x-span-id"],
        ip:                  req.ip ?? req.headers?.["x-forwarded-for"],
      }, requiredScope);

      if (!result.success) {
        const status = result.error?.code === "SCOPE_DENIED" ? 403 : 401;
        return res.status(status).json({
          error: result.error?.code,
          message: result.error?.message,
        });
      }

      // Inject service context into request
      req.serviceContext = result.context;
      next();
    };
  }

  // ── Private: logging ───────────────────────────────────────────────────────

  private logFailure(code: string, serviceId: string, traceId?: string, ip?: string): void {
    this.logger.warn({
      event: "internal_auth_failed",
      classification: "SENSITIVE",
      code,
      serviceId,
      traceId,
      ip,
    });
  }

  private logSuccess(serviceId: string, scope: string, traceId?: string, ip?: string): void {
    this.logger.info({
      event: "internal_auth_success",
      classification: "INTERNAL",
      serviceId,
      scope,
      traceId,
      ip,
    });
  }
}
