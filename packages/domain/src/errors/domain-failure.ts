// packages/domain/src/errors/domain-failure.ts

import type { ErrorCode } from "./error-codes";

export type DomainFailure = {
  success: false;

  code: ErrorCode;

  message: string;

  retryable: boolean;

  correlationId: string;

  metadata?: Readonly<Record<string, unknown>>;
};