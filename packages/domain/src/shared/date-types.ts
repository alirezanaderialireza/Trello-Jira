// packages/domain/src/shared/date-types.ts
//
// Domain-side branded date types. Mirrors the canonical definitions in
// `apps/web/src/lib/date.ts` (Phase 0.1 time engine) with identical
// brand strings, so a `DateOnly` produced on either side of the wire
// satisfies the same TypeScript identity at the boundary (TS uses
// structural typing — two `string & { readonly __brand: "DateOnly" }`
// declarations are interchangeable across module boundaries).
//
// Why mirror instead of import
//   The web-side time engine (`apps/web/src/lib/date.ts`) is the
//   runtime owner — that file holds dayjs / jalaliday plugins and is
//   the only file in the apps/web tree allowed to import them
//   (date-engine.md golden rule, enforced by ESLint). The domain
//   package can't depend on apps/web (wrong direction), so it carries
//   its own type-only declarations. Same brand string → same
//   nominal-via-structural type identity. The two files must stay in
//   lock-step; this comment is the sync rule.

/**
 * A UTC timestamp in ISO-8601 format.
 * Example: "2025-06-15T12:00:00.000Z"
 * Use for: createdAt, updatedAt, occurredAt, all persisted timestamps.
 */
export type UTCDateTime = string & { readonly __brand: "UTCDateTime" };

/**
 * A calendar date without time or timezone.
 * Example: "2025-03-30"
 * Use for: dueDate, invoiceDate, birthDate — anything that is "a day"
 * with wall-clock semantics, not an instant in time.
 */
export type DateOnly = string & { readonly __brand: "DateOnly" };
