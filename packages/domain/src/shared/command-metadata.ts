// packages/domain/src/shared/command-metadata.ts

import type {
  CorrelationId,
  MutationId,
  SpanId,
  TenantId,
  TraceId,
  UserId,
} from "./ids";

export type CommandMetadata = Readonly<{
  tenantId: TenantId;

  userId: UserId;

  mutationId: MutationId;

  correlationId: CorrelationId;

  traceId?: TraceId;

  spanId?: SpanId;

  issuedAt: Date;
}>;