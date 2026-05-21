// apps/web/src/features/board/store/invariants/canonicalSerializer.ts
// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Serialization Contract for BoardStoreState and domain events.
//
// Problem:
//   JSON.stringify() produces non-deterministic key ordering across JS engines
//   and V8 versions. Two structurally identical objects can produce different
//   JSON strings if their keys were inserted in different orders. This breaks:
//     - Event checksums (same event → different hash on different machines)
//     - Projection fingerprinting (corrupt-detection false positives)
//     - Replay verification (diff tools produce spurious mismatches)
//
// Solution:
//   canonicalStringify(): sorts all object keys recursively, handles all JSON-
//   safe types, produces identical output for identical data regardless of
//   insertion order or engine.
//
//   computeChecksum(): SHA-256 over the canonical string using crypto.subtle
//   (browser/Node.js Web Crypto API — no external dependencies).
//
//   computeChecksumSync(): fast, synchronous FNV-1a 32-bit hash for hot-path
//   use (invariant checks, devtools) where async SHA-256 is too expensive.
//
// Design:
//   - Pure functions — no side effects, no imports from store or domain
//   - Works in both browser (Web Crypto) and Node.js (Web Crypto polyfill)
//   - canonicalStringify is deterministic even across V8/JSCore/SpiderMonkey
//   - Handles: null, undefined→omitted, arrays (order preserved), nested objects
// ─────────────────────────────────────────────────────────────────────────────

// ============================================================================
// canonicalStringify
// ─────────────────────────────────────────────────────────────────────────────
// Produces a deterministic JSON string by sorting all object keys recursively.
// Rules:
//   • Object keys are sorted lexicographically (Unicode code point order)
//   • Array elements preserve their order (arrays are ordered by definition)
//   • undefined values and function properties are omitted (JSON spec)
//   • null is serialised as "null"
//   • Numbers, booleans, strings follow standard JSON encoding
// ============================================================================

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortedReplacer(value));
}

function sortedReplacer(value: unknown): unknown {
  if (value === null || value === undefined)  return value ?? null;
  if (typeof value === "function")            return undefined; // omit
  if (typeof value !== "object")              return value;     // primitive
  if (Array.isArray(value))                   return value.map(sortedReplacer);

  // Plain object: sort keys lexicographically
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = sortedReplacer((value as Record<string, unknown>)[key]);
    if (v !== undefined) sorted[key] = v;
  }
  return sorted;
}

// ============================================================================
// computeChecksum (async, SHA-256, Web Crypto API)
// ─────────────────────────────────────────────────────────────────────────────
// Returns a 64-character lowercase hex string (256 bits).
// Uses the Web Crypto API (available in browsers and Node.js ≥ 15).
// For Node.js < 15 or environments without globalThis.crypto.subtle,
// falls back to computeChecksumSync().
// ============================================================================

export async function computeChecksum(value: unknown): Promise<string> {
  const canonical = canonicalStringify(value);

  // Web Crypto path (browser + Node.js ≥ 15)
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto?.subtle?.digest
  ) {
    const encoded  = new TextEncoder().encode(canonical);
    const hashBuf  = await globalThis.crypto.subtle.digest("SHA-256", encoded);
    return bufToHex(hashBuf);
  }

  // Node.js crypto path (Node.js < 15 or test environments)
  try {
    const { createHash } = require("crypto") as typeof import("crypto");
    return createHash("sha256").update(canonical, "utf8").digest("hex");
  } catch {
    // Final fallback: FNV-1a (sync, deterministic, not cryptographic)
    return computeChecksumSync(value);
  }
}

function bufToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================================
// computeChecksumSync (FNV-1a 32-bit, synchronous)
// ─────────────────────────────────────────────────────────────────────────────
// NOT cryptographically secure — use only for devtools / hot-path invariants.
// Returns an 8-character hex string (32 bits).
// Deterministic, fast, zero dependencies.
// ============================================================================

const FNV_PRIME    = 0x01000193;
const FNV_OFFSET   = 0x811c9dc5;

export function computeChecksumSync(value: unknown): string {
  const str = canonicalStringify(value) ?? "null";
  let hash  = FNV_OFFSET >>> 0;

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash  = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ============================================================================
// EventChecksum — wraps a domain event with its canonical checksum
// ============================================================================

export interface EventWithChecksum<T = unknown> {
  event:    T;
  checksum: string; // hex — 64 chars (SHA-256) or 8 chars (FNV sync fallback)
  algorithm: "sha256" | "fnv1a32";
}

/**
 * Wraps a domain event with its SHA-256 checksum.
 * Used when writing to the outbox and when validating received events.
 */
export async function stampEventChecksum<T>(event: T): Promise<EventWithChecksum<T>> {
  const checksum = await computeChecksum(event);
  return {
    event,
    checksum,
    algorithm: checksum.length === 64 ? "sha256" : "fnv1a32",
  };
}

/**
 * Verifies that an event's payload matches its attached checksum.
 * Returns true if valid, false if tampered/corrupted.
 */
export async function verifyEventChecksum<T>(stamped: EventWithChecksum<T>): Promise<boolean> {
  const expected = await computeChecksum(stamped.event);
  return expected === stamped.checksum;
}
