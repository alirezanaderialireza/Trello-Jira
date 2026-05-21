// apps/web/src/lib/error/reportError.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Client-side error reporter
//
// Architecture (Phase 0.5):
//   ErrorBoundary.componentDidCatch() ─┐
//   GlobalErrorListener (window.error)─┼─→ reportError(fingerprint)
//   GlobalErrorListener (unhandled)   ─┘            │
//                                                   │
//                             ┌─── dedup (in-memory, 1-min TTL)
//                             ├─── enrich with build SHA + URL + UA
//                             ├─── POST /api/errors (keepalive)
//                             └─── on failure: queue in localStorage
//                                  flushed on next successful report
//
// Why a single helper rather than inlined fetch:
//   1. The boundary AND the global listeners need the exact same payload
//      shape; centralising the fingerprint construction guarantees a
//      consistent log schema.
//   2. Rolling our own dedup is cheaper than letting a runaway component
//      fire 1000 reports/sec into Vercel Functions.
//   3. The localStorage queue means a flaky network does not lose errors
//      that happened during the connectivity blip.
//
// This module never throws — every code path is wrapped in try/catch so a
// reporting failure cannot itself crash the app.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────────

export type ErrorScope =
  | "Board"
  | "List"
  | "Card"
  | "Modal"
  | "Root"
  | "Async"
  | "Promise"
  | "Unknown";

export interface ErrorFingerprint {
  /** Granularity level — "Board" / "List" / "Card" / "Modal" / "Root" / "Async". */
  scope: ErrorScope;
  /** Domain entity kind ("board" | "list" | "card") when applicable. */
  entityKind?: "board" | "list" | "card";
  /** Specific entity id; presence depends on `entityKind`. */
  entityId?: string;
  /** Single-line error message — first 500 chars. */
  message: string;
  /** Stack trace as captured by V8 — first 2000 chars. */
  stack?: string;
  /** React component stack from `componentDidCatch` — first 1000 chars. */
  componentStack?: string;
  /** ISO-8601 UTC timestamp at the time of capture. */
  timestamp: string;
  /** Page URL (best-effort, only available in browser). */
  url?: string;
  /** Captured `navigator.userAgent`. */
  userAgent?: string;
  /** Build SHA injected at compile time via `NEXT_PUBLIC_BUILD_SHA`. */
  buildSha?: string;
  /** Free-form context bag for debugging. */
  context?: Record<string, unknown>;
}

// ─── Build-time metadata ─────────────────────────────────────────────────────

const BUILD_SHA =
  // Wired through next.config; falls back to "dev" when running locally.
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BUILD_SHA) ||
  "dev";

// ─── Dedup ───────────────────────────────────────────────────────────────────
//
// A naive `console.error → fetch` loop can fire thousands of identical
// reports per second. We collapse identical fingerprints (same scope + same
// first 200 chars of the message + first 200 chars of the component stack)
// into a single report per minute window.

const DEDUP_WINDOW_MS = 60_000;
const dedupCache = new Map<string, number>();

function dedupKey(fp: ErrorFingerprint): string {
  return [
    fp.scope,
    fp.entityKind ?? "",
    fp.entityId ?? "",
    (fp.message || "").slice(0, 200),
    (fp.componentStack || "").slice(0, 200),
  ].join("|");
}

function shouldDedup(fp: ErrorFingerprint): boolean {
  const key = dedupKey(fp);
  const now = Date.now();
  const last = dedupCache.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  dedupCache.set(key, now);

  // Bound the cache so a stream of distinct errors cannot leak memory.
  if (dedupCache.size > 200) {
    const cutoff = now - DEDUP_WINDOW_MS;
    for (const [k, t] of dedupCache) {
      if (t < cutoff) dedupCache.delete(k);
    }
  }
  return false;
}

// ─── Persistent queue (for offline / network-blip recovery) ──────────────────

const QUEUE_KEY = "kiro:error-queue";
const MAX_QUEUE_SIZE = 50;

function readQueue(): ErrorFingerprint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_QUEUE_SIZE) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: ErrorFingerprint[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify(items.slice(-MAX_QUEUE_SIZE)),
    );
  } catch {
    // localStorage may be disabled or full — best-effort; just skip.
  }
}

function enqueue(fp: ErrorFingerprint): void {
  const queue = readQueue();
  queue.push(fp);
  writeQueue(queue);
}

/**
 * Drain the persisted queue and POST each entry. Called whenever a fresh
 * report succeeds — at that point the network is presumably back.
 */
async function flushQueue(): Promise<void> {
  const queue = readQueue();
  if (queue.length === 0) return;

  const survivors: ErrorFingerprint[] = [];
  for (const fp of queue) {
    const ok = await sendOne(fp).catch(() => false);
    if (!ok) survivors.push(fp);
  }
  writeQueue(survivors);
}

// ─── Transport ───────────────────────────────────────────────────────────────

async function sendOne(fp: ErrorFingerprint): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const res = await fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fp),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Public surface ──────────────────────────────────────────────────────────

/**
 * Build a fingerprint from a thrown value (`Error` or anything else) and a
 * scope hint. Pure — does not transmit anything.
 */
export function buildFingerprint(
  error: unknown,
  scope: ErrorScope,
  extra: Partial<ErrorFingerprint> = {},
): ErrorFingerprint {
  const err = error instanceof Error ? error : null;
  const message = err?.message ?? safeStringify(error);

  return {
    scope,
    message: message.slice(0, 500),
    stack: err?.stack?.slice(0, 2000),
    timestamp: new Date().toISOString(),
    url: typeof window !== "undefined" ? window.location.href : undefined,
    userAgent:
      typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    buildSha: BUILD_SHA,
    ...extra,
  };
}

/**
 * Report an error to the backend. Never throws.
 *
 * Caller responsibilities:
 *   • Hand us a fully-built fingerprint (via `buildFingerprint`) or a raw
 *     Error and let us shape it.
 *   • In dev we always console.error; in prod we POST.
 *
 * The function returns void by design — callers should not branch on
 * "did the report succeed". We handle retries internally via the queue.
 */
export function reportError(fp: ErrorFingerprint): void {
  // Always print to the dev console — fastest possible feedback loop.
  if (process.env.NODE_ENV !== "production") {
    console.error(`[reportError:${fp.scope}]`, fp);
  }

  // Skip dedup'd entries silently.
  if (shouldDedup(fp)) return;

  // Best-effort POST. On failure, queue for retry.
  if (typeof window === "undefined") return;
  void sendOne(fp).then((ok) => {
    if (ok) {
      // Successful send — try to flush any queued entries from past failures.
      void flushQueue();
    } else {
      enqueue(fp);
    }
  });
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  try {
    if (value === null || value === undefined) return String(value);
    if (typeof value === "string") return value;
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return "[unserialisable]";
  }
}
