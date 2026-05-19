// apps/web/src/features/board/store/sync/eventSchemaVersioning.ts
// -----------------------------------------------------------------------------
// Event Schema Versioning System.
//
// Problem:
//   Domain event payloads evolve over time. A v1 "card.moved" payload may lack
//   fields that v2 expects (e.g., `boardId` was added in v2). Without versioning,
//   replaying old events or receiving events from an older server/client crashes
//   the reducer or produces corrupt state.
//
// Solution:
//   - Every event carries an explicit `schemaVersion` (integer, monotonic)
//   - A registry of migration adapters transforms older payloads to current
//   - Compatibility validation rejects events that cannot be safely applied
//   - The system is forward-compatible: unknown future versions are buffered
//     (not rejected) until the client updates
//
// Design:
//   - Pure functions — no side effects, fully testable
//   - Registry pattern — adapters are registered per event type
//   - Chain migrations — v1→v2→v3 automatically chains
//   - Validation gate — called before dispatcher.applyEvent
//   - Integrates with ReplayEngine via `migrateEvent` config hook
// -----------------------------------------------------------------------------

import type { AppDomainEvent, DomainEventType } from "@repo/domain";
import type { JournalEntry } from "./replayEngine";

// ============================================================================
// Types
// ============================================================================

/** Current schema version for each event type */
export type EventSchemaVersion = number;

/**
 * Migration adapter: transforms payload from `fromVersion` to `fromVersion + 1`.
 * Must be pure, deterministic, and side-effect free.
 */
export type MigrationAdapter = (payload: Record<string, unknown>) => Record<string, unknown>;

/** Registry entry for a single event type */
export interface EventTypeSchema {
  /** Current (latest) version for this event type */
  currentVersion: EventSchemaVersion;
  /** Ordered migration adapters: index 0 = v1→v2, index 1 = v2→v3, etc. */
  migrations: MigrationAdapter[];
}

/** Validation result */
export type SchemaValidationResult =
  | { valid: true; migrated: boolean; originalVersion: number; targetVersion: number }
  | { valid: false; reason: SchemaValidationError; originalVersion: number; targetVersion: number };

export type SchemaValidationError =
  | "UNKNOWN_EVENT_TYPE"
  | "VERSION_TOO_NEW"    // client is behind server — buffer, don't reject
  | "MIGRATION_FAILED"
  | "PAYLOAD_INVALID";

// ============================================================================
// Schema Registry
// ============================================================================

/**
 * Central registry of all event type schemas and their migration chains.
 *
 * Example:
 *   registerEventSchema("card.moved", {
 *     currentVersion: 3,
 *     migrations: [
 *       // v1 → v2: added boardId
 *       (payload) => ({ ...payload, boardId: payload.boardId ?? "" }),
 *       // v2 → v3: renamed oldPosition → previousPosition
 *       (payload) => {
 *         const { oldPosition, ...rest } = payload;
 *         return { ...rest, previousPosition: oldPosition ?? "" };
 *       },
 *     ],
 *   });
 */
const SCHEMA_REGISTRY = new Map<string, EventTypeSchema>();

export function registerEventSchema(eventType: string, schema: EventTypeSchema): void {
  if (schema.migrations.length !== schema.currentVersion - 1) {
    throw new Error(
      `[EventSchemaVersioning] Migration count mismatch for "${eventType}": ` +
        `expected ${schema.currentVersion - 1} migrations, got ${schema.migrations.length}`,
    );
  }
  SCHEMA_REGISTRY.set(eventType, schema);
}

export function getEventSchema(eventType: string): EventTypeSchema | undefined {
  return SCHEMA_REGISTRY.get(eventType);
}

export function getCurrentVersion(eventType: string): EventSchemaVersion {
  return SCHEMA_REGISTRY.get(eventType)?.currentVersion ?? 1;
}

// ============================================================================
// Default Schema Registrations (current codebase)
// ============================================================================
// All events are currently at v1 — no migrations needed yet.
// When a payload evolves, add a migration adapter and bump currentVersion.
// ============================================================================

function registerDefaults(): void {
  const v1Events: DomainEventType[] = [
    "card.created",
    "card.moved",
    "card.updated",
    "card.deleted",
    "list.created",
    "list.moved",
    "list.updated",
    "list.deleted",
    "board.created",
    "board.renamed",
    "board.archived",
    "board.unarchived",
    "board.visibility_changed",
  ];

  for (const eventType of v1Events) {
    if (!SCHEMA_REGISTRY.has(eventType)) {
      SCHEMA_REGISTRY.set(eventType, { currentVersion: 1, migrations: [] });
    }
  }
}

// Auto-register defaults on module load
registerDefaults();

// ============================================================================
// Migration Engine
// ============================================================================

/**
 * Migrate an event payload from its declared version to the current version.
 *
 * Migration chain is applied sequentially:
 *   v1 payload → migration[0] → v2 payload → migration[1] → v3 payload → ...
 *
 * Returns the migrated payload or throws on failure.
 */
export function migratePayload(
  eventType: string,
  payload: Record<string, unknown>,
  fromVersion: EventSchemaVersion,
): { payload: Record<string, unknown>; toVersion: EventSchemaVersion } {
  const schema = SCHEMA_REGISTRY.get(eventType);
  if (!schema) {
    // Unknown event type — return as-is (forward-compat)
    return { payload, toVersion: fromVersion };
  }

  if (fromVersion >= schema.currentVersion) {
    // Already at or above current — no migration needed
    return { payload, toVersion: fromVersion };
  }

  let current = payload;
  for (let v = fromVersion; v < schema.currentVersion; v++) {
    const migrationIndex = v - 1; // v1→v2 is migrations[0]
    const adapter = schema.migrations[migrationIndex];
    if (!adapter) {
      throw new MigrationError(
        eventType,
        v,
        v + 1,
        `Missing migration adapter for v${v}→v${v + 1}`,
      );
    }

    try {
      current = adapter(current);
    } catch (err: any) {
      throw new MigrationError(
        eventType,
        v,
        v + 1,
        err?.message ?? "Migration adapter threw",
      );
    }
  }

  return { payload: current, toVersion: schema.currentVersion };
}

// ============================================================================
// Compatibility Validation Gate
// ============================================================================

/**
 * Validates whether an incoming event can be safely applied to the store.
 * Called before dispatcher.applyEvent.
 *
 * Scenarios:
 *   1. Event version == current → valid, no migration needed
 *   2. Event version < current → migrate up, then valid
 *   3. Event version > current → client is behind server (VERSION_TOO_NEW)
 *      The caller should buffer this event until client code is updated.
 *   4. Unknown event type → forward-compat: skip (don't crash)
 */
export function validateAndMigrateEvent(event: AppDomainEvent): {
  result: SchemaValidationResult;
  migratedEvent: AppDomainEvent | null;
} {
  const eventType = event.type;
  const declaredVersion = (event as any).schemaVersion ?? 1;
  const schema = SCHEMA_REGISTRY.get(eventType);

  // Unknown event type — forward-compat (new event type from newer server)
  if (!schema) {
    return {
      result: {
        valid: false,
        reason: "UNKNOWN_EVENT_TYPE",
        originalVersion: declaredVersion,
        targetVersion: 1,
      },
      migratedEvent: null,
    };
  }

  const targetVersion = schema.currentVersion;

  // Already at current version — no migration needed
  if (declaredVersion === targetVersion) {
    return {
      result: { valid: true, migrated: false, originalVersion: declaredVersion, targetVersion },
      migratedEvent: event,
    };
  }

  // Event is from the future — client needs to update
  if (declaredVersion > targetVersion) {
    return {
      result: {
        valid: false,
        reason: "VERSION_TOO_NEW",
        originalVersion: declaredVersion,
        targetVersion,
      },
      migratedEvent: null,
    };
  }

  // Event is older — migrate up
  try {
    const { payload: migratedPayload, toVersion } = migratePayload(
      eventType,
      event.payload as Record<string, unknown>,
      declaredVersion,
    );

    const migratedEvent: AppDomainEvent = {
      ...event,
      payload: migratedPayload as any,
      schemaVersion: toVersion,
    } as any;

    return {
      result: { valid: true, migrated: true, originalVersion: declaredVersion, targetVersion: toVersion },
      migratedEvent,
    };
  } catch (err: any) {
    return {
      result: {
        valid: false,
        reason: "MIGRATION_FAILED",
        originalVersion: declaredVersion,
        targetVersion,
      },
      migratedEvent: null,
    };
  }
}

// ============================================================================
// ReplayEngine Integration Hook
// ============================================================================

/**
 * Adapter for ReplayEngine's `migrateEvent` config.
 * Transforms a JournalEntry's payload to the current schema version.
 */
export function migrateJournalEntry(entry: JournalEntry): JournalEntry {
  const declaredVersion = Number(entry.eventVersion ?? "1");
  const schema = SCHEMA_REGISTRY.get(entry.type);

  if (!schema || declaredVersion >= schema.currentVersion) {
    return entry; // Already current or unknown type
  }

  const { payload: migratedPayload } = migratePayload(
    entry.type,
    entry.payload.payload as Record<string, unknown>,
    declaredVersion,
  );

  return {
    ...entry,
    payload: {
      ...entry.payload,
      payload: migratedPayload as any,
      schemaVersion: schema.currentVersion,
    } as any,
    eventVersion: String(schema.currentVersion),
  };
}

// ============================================================================
// MigrationError
// ============================================================================

export class MigrationError extends Error {
  constructor(
    public readonly eventType: string,
    public readonly fromVersion: number,
    public readonly toVersion: number,
    message: string,
  ) {
    super(`[EventSchemaVersioning] ${eventType} v${fromVersion}→v${toVersion}: ${message}`);
    this.name = "MigrationError";
  }
}

// ============================================================================
// Utilities
// ============================================================================

/** Get all registered event types and their versions (for devtools) */
export function getSchemaRegistry(): ReadonlyMap<string, EventTypeSchema> {
  return SCHEMA_REGISTRY;
}

/** Reset registry (for testing) */
export function resetSchemaRegistry(): void {
  SCHEMA_REGISTRY.clear();
  registerDefaults();
}
