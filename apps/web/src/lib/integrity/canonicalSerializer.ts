// apps/web/src/lib/integrity/canonicalSerializer.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Deterministic serialization and integrity-checking primitives for events,
// state snapshots, and arbitrary payloads.
//
// This module is the single source of truth for:
//   1. canonicalJSON(value) — stable string regardless of key insertion order.
//   2. computeChecksum(data) — SHA-256 hex (async) or djb2 hex (sync fallback).
//   3. stampEvent(event) — annotates an AppDomainEvent with a checksum for
//      integrity verification during replay and audit.
//   4. verifyEventChecksum(event) — validates a stamped event's integrity.
//   5. canonicalCompare(a, b) — structural equality via canonical form.
//
// ─── Design rules ────────────────────────────────────────────────────────────
//   • Pure — no store reads, no side effects.
//   • Deterministic — same input → same output across all environments.
//   • No external dependencies — uses Web standard SubtleCrypto + djb2 fallback.
//   • Extracted from projectionIntegrity.ts for reuse across replay, FSM, tests.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppDomainEvent } from "@repo/domain";

// ============================================================================
// 1.  Canonical JSON
// ============================================================================

/**
 * Recursively serialises a value to canonical JSON.
 *   • Object keys are sorted lexicographically (deterministic regardless of
 *     insertion order).
 *   • Arrays preserve their element order.
 *   • Primitives use standard JSON.stringify.
 *   • undefined values in objects are omitted (matching JSON spec).
 *
 * @param value  Any JSON-serializable value.
 * @returns      A stable string representation.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]";
  }

  // Object — sort keys for determinism.
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];

  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) continue; // omit undefined (JSON spec)
    parts.push(`${JSON.stringify(key)}:${canonicalJSON(v)}`);
  }

  return "{" + parts.join(",") + "}";
}

// ============================================================================
// 2.  Hash implementations
// ============================================================================

/**
 * Synchronous djb2 hash → 8-char hex string.
 * Used as fallback in environments without SubtleCrypto (test runners, SSR).
 */
export function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Async SHA-256 via Web Crypto API → 64-char hex string.
 * Returns null if SubtleCrypto is unavailable (caller should fallback to djb2).
 */
export async function sha256(input: string): Promise<string | null> {
  if (
    typeof crypto === "undefined" ||
    typeof crypto.subtle === "undefined" ||
    typeof crypto.subtle.digest !== "function"
  ) {
    return null;
  }

  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================================
// 3.  Unified checksum API
// ============================================================================

export interface Checksum {
  /** Hex hash string. */
  readonly hash: string;
  /** Algorithm used. */
  readonly algorithm: "sha256" | "djb2";
}

/**
 * Computes a checksum over any serializable value.
 * Prefers SHA-256; falls back to djb2 synchronously.
 */
export async function computeChecksum(value: unknown): Promise<Checksum> {
  const canonical = canonicalJSON(value);
  const hash = await sha256(canonical);

  if (hash !== null) {
    return { hash, algorithm: "sha256" };
  }

  return { hash: djb2Hash(canonical), algorithm: "djb2" };
}

/**
 * Synchronous checksum using djb2 only.
 * Use when you cannot await (e.g. inside Zustand set() or test assertions).
 */
export function computeChecksumSync(value: unknown): Checksum {
  const canonical = canonicalJSON(value);
  return { hash: djb2Hash(canonical), algorithm: "djb2" };
}

// ============================================================================
// 4.  Event stamping — integrity annotation for replay & audit
// ============================================================================

/** An AppDomainEvent annotated with an integrity checksum over its payload. */
export interface StampedEvent {
  /** The original domain event. */
  readonly event: AppDomainEvent;
  /** Checksum computed over canonicalJSON(event.payload). */
  readonly payloadChecksum: Checksum;
  /** Checksum computed over canonicalJSON(event) — full event integrity. */
  readonly eventChecksum: Checksum;
}

/**
 * Stamps a domain event with checksums for both:
 *   1. payload only  (for content-addressable dedup)
 *   2. full event    (for tamper detection in audit)
 *
 * Async — uses SHA-256 when available.
 */
export async function stampEvent(event: AppDomainEvent): Promise<StampedEvent> {
  const [payloadChecksum, eventChecksum] = await Promise.all([
    computeChecksum(event.payload),
    computeChecksum(event),
  ]);

  return { event, payloadChecksum, eventChecksum };
}

/**
 * Synchronous variant using djb2.
 */
export function stampEventSync(event: AppDomainEvent): StampedEvent {
  return {
    event,
    payloadChecksum: computeChecksumSync(event.payload),
    eventChecksum: computeChecksumSync(event),
  };
}

// ============================================================================
// 5.  Verification
// ============================================================================

export type VerifyResult =
  | { valid: true }
  | { valid: false; reason: "PAYLOAD_MISMATCH" | "EVENT_MISMATCH" };

/**
 * Verifies a previously-stamped event's integrity.
 * Returns a typed result — never throws.
 */
export async function verifyEventChecksum(
  stamped: StampedEvent,
): Promise<VerifyResult> {
  const currentPayload = await computeChecksum(stamped.event.payload);
  if (currentPayload.hash !== stamped.payloadChecksum.hash) {
    return { valid: false, reason: "PAYLOAD_MISMATCH" };
  }

  const currentEvent = await computeChecksum(stamped.event);
  if (currentEvent.hash !== stamped.eventChecksum.hash) {
    return { valid: false, reason: "EVENT_MISMATCH" };
  }

  return { valid: true };
}

/**
 * Synchronous verification using djb2.
 */
export function verifyEventChecksumSync(stamped: StampedEvent): VerifyResult {
  const currentPayload = computeChecksumSync(stamped.event.payload);
  if (currentPayload.hash !== stamped.payloadChecksum.hash) {
    return { valid: false, reason: "PAYLOAD_MISMATCH" };
  }

  const currentEvent = computeChecksumSync(stamped.event);
  if (currentEvent.hash !== stamped.eventChecksum.hash) {
    return { valid: false, reason: "EVENT_MISMATCH" };
  }

  return { valid: true };
}

// ============================================================================
// 6.  Structural comparison
// ============================================================================

/**
 * Deep structural equality check using canonical form.
 * Useful in tests and assertions where reference equality is insufficient.
 */
export function canonicalCompare(a: unknown, b: unknown): boolean {
  return canonicalJSON(a) === canonicalJSON(b);
}

// ============================================================================
// 7.  Batch stamping — for replay validation
// ============================================================================

/**
 * Stamps an entire event stream. Returns a map of eventId → StampedEvent.
 * Useful for building a checksum ledger before replay.
 */
export async function stampEventStream(
  events: readonly AppDomainEvent[],
): Promise<Map<string, StampedEvent>> {
  const results = new Map<string, StampedEvent>();

  // Process in chunks of 50 to avoid microtask starvation on large streams.
  const CHUNK_SIZE = 50;
  for (let i = 0; i < events.length; i += CHUNK_SIZE) {
    const chunk = events.slice(i, i + CHUNK_SIZE);
    const stamped = await Promise.all(chunk.map(stampEvent));
    for (const s of stamped) {
      results.set(s.event.id, s);
    }
  }

  return results;
}

/**
 * Synchronous variant — for use in test runners.
 */
export function stampEventStreamSync(
  events: readonly AppDomainEvent[],
): Map<string, StampedEvent> {
  const results = new Map<string, StampedEvent>();
  for (const event of events) {
    results.set(event.id, stampEventSync(event));
  }
  return results;
}
