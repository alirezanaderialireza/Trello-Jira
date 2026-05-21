// packages/domain/src/errors/error-codes.ts

// =============================================================================
// 🔹 Core Domain Error Codes
// =============================================================================
export type DomainErrorReason =
  // ===========================================================================
  // OCC / Realtime Synchronization
  // ===========================================================================
  | "STALE_REVISION"
  | "ACL_MISMATCH"
  | "GAP_UNRECOVERABLE"
  | "OUTBOX_LAGGING"

  // ===========================================================================
  // Ordering / Positioning / Topology
  // ===========================================================================
  | "CROSS_BOARD_VIOLATION"
  | "INVALID_CHAIN"
  | "CORRUPTED_CHAIN"
  | "TOPOLOGY_MISMATCH"

  // ===========================================================================
  // Authorization / Security
  // ===========================================================================
  | "UNAUTHORIZED"
  | "FORBIDDEN"

  // ===========================================================================
  // Resource / Entity State
  // ===========================================================================
  | "NOT_FOUND"
  | "BOARD_ARCHIVED"
  | "LIST_LIMIT_REACHED"
  | "CARD_LOCKED"

  // ===========================================================================
  // Request / Command Validation
  // ===========================================================================
  | "INVALID_REQUEST_PAYLOAD"
  | "COMMAND_EXPIRED"

  // ===========================================================================
  // Infrastructure / Transaction
  // ===========================================================================
  | "DEADLOCK_DETECTED";

// =============================================================================
// 🔹 ErrorCode — public alias used in DomainFailure.code
// -----------------------------------------------------------------------------
// DomainErrorReason و ErrorCode یکی هستند.
// این alias باعث می‌شود domain-failure.ts بتواند import کند
// و اگر فردا error taxonomy گسترش یافت، DomainFailure contract نشکند.
// =============================================================================
export type ErrorCode = DomainErrorReason;

// =============================================================================
// 🔹 Constants Object for safe lookup / exhaustive switch
// =============================================================================
export const DomainErrorCodes: Record<DomainErrorReason, DomainErrorReason> = {
  STALE_REVISION: "STALE_REVISION",
  ACL_MISMATCH: "ACL_MISMATCH",
  GAP_UNRECOVERABLE: "GAP_UNRECOVERABLE",
  OUTBOX_LAGGING: "OUTBOX_LAGGING",
  CROSS_BOARD_VIOLATION: "CROSS_BOARD_VIOLATION",
  INVALID_CHAIN: "INVALID_CHAIN",
  CORRUPTED_CHAIN: "CORRUPTED_CHAIN",
  TOPOLOGY_MISMATCH: "TOPOLOGY_MISMATCH",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  BOARD_ARCHIVED: "BOARD_ARCHIVED",
  LIST_LIMIT_REACHED: "LIST_LIMIT_REACHED",
  CARD_LOCKED: "CARD_LOCKED",
  INVALID_REQUEST_PAYLOAD: "INVALID_REQUEST_PAYLOAD",
  COMMAND_EXPIRED: "COMMAND_EXPIRED",
  DEADLOCK_DETECTED: "DEADLOCK_DETECTED",
};