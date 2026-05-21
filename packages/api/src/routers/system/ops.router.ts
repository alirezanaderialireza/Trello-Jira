import { performance } from "node:perf_hooks";
import * as os from "node:os";

import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  router,
  protectedProcedure,
} from "../../trpc";

// ============================================================================
// 🧩 Constants
// ============================================================================

const HEALTHCHECK_TIMEOUT_MS =
  3_000;

const SERVICE_STATUS = {
  OPERATIONAL:
    "OPERATIONAL",

  DEGRADED:
    "DEGRADED",

  OUTAGE:
    "OUTAGE",
} as const;

// ============================================================================
// 🧠 Types
// ============================================================================

type ServiceStatus =
  (typeof SERVICE_STATUS)[keyof typeof SERVICE_STATUS];

interface ComponentHealth {
  healthy: boolean;

  latencyMs?: number;

  details?: string;
}

export interface HealthCheckResponse {
  status: ServiceStatus;

  timestamp: number;

  isoTimestamp: string;

  uptimeSeconds: number;

  environment: string;

  region?: string;

  version?: string;

  commitSha?: string;

  checks: {
    database: ComponentHealth;

    redis: ComponentHealth;

    websocket: ComponentHealth;
  };

  system: {
    memory: {
      rssMb: number;

      heapUsedMb: number;

      heapTotalMb: number;
    };

    cpu: {
      loadAverage: number[];
    };

    nodeVersion: string;
  };
}

// ============================================================================
// 🛡️ Helpers
// ============================================================================

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutHandle:
    | NodeJS.Timeout
    | undefined;

  const timeoutPromise =
    new Promise<never>(
      (_, reject) => {
        timeoutHandle =
          setTimeout(() => {
            reject(
              new Error(
                "HEALTHCHECK_TIMEOUT"
              )
            );
          }, timeoutMs);
      }
    );

  return Promise.race([
    promise,
    timeoutPromise,
  ]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(
        timeoutHandle
      );
    }
  });
}

function bytesToMb(
  bytes: number
): number {
  return (
    Math.round(
      (bytes /
        1024 /
        1024) *
        100
    ) / 100
  );
}

function calculateOverallStatus(
  checks: HealthCheckResponse["checks"]
): ServiceStatus {
  const values =
    Object.values(checks);

  const healthyCount =
    values.filter(
      (value) =>
        value.healthy
    ).length;

  if (
    healthyCount ===
    values.length
  ) {
    return SERVICE_STATUS.OPERATIONAL;
  }

  if (healthyCount > 0) {
    return SERVICE_STATUS.DEGRADED;
  }

  return SERVICE_STATUS.OUTAGE;
}

// ============================================================================
// 🚀 Enterprise Ops Router
// ============================================================================

export const opsRouter =
  router({
    // ==========================================================================
    // ❤️ Health Check
    // ==========================================================================

    healthCheck:
      protectedProcedure

        .input(
          z
            .object({
              verbose:
                z
                  .boolean()
                  .default(
                    false
                  ),
            })
            .optional()
        )

        .query(
          async ({
            ctx,
          }): Promise<HealthCheckResponse> => {
            const startedAt =
              performance.now();

            const trace = {
              traceId:
                ctx.metadata
                  ?.traceId,

              correlationId:
                ctx.metadata
                  ?.requestId,

              operation:
                "ops_healthcheck",

              userId:
                ctx.session
                  .user.id,

              tenantId:
                ctx.session
                  .tenantId,
            };

            // ================================================================
            // 🔐 1. Authorization Boundary
            // ================================================================

            const roles =
              ctx.session
                .roles ?? [];

            if (
              !roles.includes(
                "SUPER_ADMIN"
              )
            ) {
              ctx.infra.logger.warn(
                {
                  event:
                    "ops_healthcheck_forbidden",

                  classification:
                    "SENSITIVE",

                  ...trace,
                }
              );

              throw new TRPCError(
                {
                  code:
                    "FORBIDDEN",

                  message:
                    "Ops access restricted.",
                }
              );
            }

            try {
              // ================================================================
              // 🗄️ 2. Database Health
              // ================================================================

              const dbStartedAt =
                performance.now();

              let database: ComponentHealth =
                {
                  healthy:
                    false,
                };

              try {
                await withTimeout(
                  ctx.infra.db.execute(
                    sql`SELECT 1`
                  ),
                  HEALTHCHECK_TIMEOUT_MS
                );

                database = {
                  healthy:
                    true,

                  latencyMs:
                    Math.round(
                      performance.now() -
                        dbStartedAt
                    ),
                };
              } catch (
                error: any
              ) {
                database = {
                  healthy:
                    false,

                  latencyMs:
                    Math.round(
                      performance.now() -
                        dbStartedAt
                    ),

                  details:
                    error?.message ||
                    "DATABASE_HEALTHCHECK_FAILED",
                };
              }

              // ================================================================
              // 📡 3. Redis / Presence Health
              // ================================================================

              const redisStartedAt =
                performance.now();

              let redis: ComponentHealth =
                {
                  healthy:
                    false,
                };

              try {
                if (
                  ctx.infra
                    .presenceStore
                    ?.get
                ) {
                  await withTimeout(
                    ctx.infra.presenceStore.get(
                      "healthcheck_ping"
                    ),
                    HEALTHCHECK_TIMEOUT_MS
                  );
                }

                redis = {
                  healthy:
                    !!ctx.infra
                      .presenceStore,

                  latencyMs:
                    Math.round(
                      performance.now() -
                        redisStartedAt
                    ),
                };
              } catch (
                error: any
              ) {
                redis = {
                  healthy:
                    false,

                  latencyMs:
                    Math.round(
                      performance.now() -
                        redisStartedAt
                    ),

                  details:
                    error?.message ||
                    "REDIS_HEALTHCHECK_FAILED",
                };
              }

              // ================================================================
              // 🌐 4. WebSocket Gateway Health
              // ================================================================

              const websocketStartedAt =
                performance.now();

              let websocket: ComponentHealth =
                {
                  healthy:
                    false,
                };

              try {
                const wsGateway =
                  (ctx.infra as any)
                    .websocketGateway;

                websocket = {
                  healthy:
                    !!wsGateway,

                  latencyMs:
                    Math.round(
                      performance.now() -
                        websocketStartedAt
                    ),
                };
              } catch (
                error: any
              ) {
                websocket = {
                  healthy:
                    false,

                  details:
                    error?.message ||
                    "WEBSOCKET_HEALTHCHECK_FAILED",
                };
              }

              // ================================================================
              // 🧠 5. Runtime System Metrics
              // ================================================================

              const memoryUsage =
                process.memoryUsage();

              const systemMetrics =
                {
                  memory: {
                    rssMb:
                      bytesToMb(
                        memoryUsage.rss
                      ),

                    heapUsedMb:
                      bytesToMb(
                        memoryUsage.heapUsed
                      ),

                    heapTotalMb:
                      bytesToMb(
                        memoryUsage.heapTotal
                      ),
                  },

                  cpu: {
                    loadAverage:
                      typeof os.loadavg ===
                      "function"
                        ? os.loadavg()
                        : [],
                  },

                  nodeVersion:
                    process.version,
                };

              // ================================================================
              // 📊 6. Aggregate Status
              // ================================================================

              const checks = {
                database,
                redis,
                websocket,
              };

              const overallStatus =
                calculateOverallStatus(
                  checks
                );

              // ================================================================
              // 📈 7. Structured Observability
              // ================================================================

              ctx.infra.logger.info(
                {
                  event:
                    "ops_healthcheck_completed",

                  classification:
                    "INTERNAL",

                  overallStatus,

                  dbHealthy:
                    database.healthy,

                  redisHealthy:
                    redis.healthy,

                  websocketHealthy:
                    websocket.healthy,

                  durationMs:
                    Math.round(
                      performance.now() -
                        startedAt
                    ),

                  ...trace,
                }
              );

              // ================================================================
              // ✅ 8. Response
              // ================================================================

              return {
                status:
                  overallStatus,

                timestamp:
                  Date.now(),

                isoTimestamp:
                  new Date().toISOString(),

                uptimeSeconds:
                  Math.floor(
                    process.uptime()
                  ),

                environment:
                  process.env
                    .NODE_ENV ||
                  "development",

                region:
                  process.env
                    .VERCEL_REGION,

                version:
                  process.env
                    .APP_VERSION,

                commitSha:
                  process.env
                    .COMMIT_SHA,

                checks,

                system:
                  systemMetrics,
              };
            } catch (
              error: any
            ) {
              ctx.infra.logger.error(
                {
                  event:
                    "ops_healthcheck_failed",

                  classification:
                    "INTERNAL",

                  safeErrorCode:
                    error?.code ||
                    error?.name ||
                    "UNKNOWN_HEALTHCHECK_ERROR",

                  durationMs:
                    Math.round(
                      performance.now() -
                        startedAt
                    ),

                  ...trace,
                }
              );

              if (
                error instanceof
                TRPCError
              ) {
                throw error;
              }

              throw new TRPCError(
                {
                  code:
                    "INTERNAL_SERVER_ERROR",

                  message:
                    "Healthcheck failed.",
                }
              );
            }
          }
        ),
  });