// packages/infrastructure/src/auth/serviceAuth/index.ts
// Barrel export for Service-to-Service Auth layer.

export { ServiceTokenService, ServiceAuthError } from "./serviceTokenService";
export type { ServiceName, ServiceTokenClaims, ServiceTokenConfig } from "./serviceTokenService";

export { ServiceAcl, getServiceAcl } from "./serviceAcl";
export type { ServiceScope, ServiceRegistration } from "./serviceAcl";

export { InternalAuthMiddleware } from "./internalAuthMiddleware";
export type { InternalAuthContext, InternalAuthResult, InternalRequestContext } from "./internalAuthMiddleware";
