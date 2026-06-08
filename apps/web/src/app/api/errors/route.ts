// apps/web/src/app/api/errors/route.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/errors
//
// Receives client-side error fingerprints (from `reportError` in
// `apps/web/src/lib/error/reportError.ts`) and records them. Sized for
// MVP: structured `console.error` log lines, behind a per-IP rate limit
// so a single misbehaving client can't flood the server.
//
// Why not Sentry / external service:
//   The team is still on a single hosting environment without an
//   observability vendor. A plain `console.error` shows up in the
//   platform's own log drain (Vercel / Fly / Railway), which is
//   sufficient until we promote this to a dedicated audit table or a
//   third-party. Migrating later is one swap of the body of `record()`.
//
// Hardening:
//   • Zod validates the payload shape — we drop anything malformed.
//   • Rate-limited to 60 reports/15 min/IP via the existing helper used
//     by signup/signin (in-memory window). An attacker can still flood
//     across many IPs, but the goal here is "stop our own client from
//     looping", not stop a real DDoS.
//   • Session enrichment (userId / tenantId) is read from the auth
//     session ON THE SERVER, never from the request body. The client
//     can't lie about whose error this is.
//   • Returns 200 on accept / drop alike so the client never branches
//     on the response shape.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitResponse } from "@repo/api/middleware/authRateLimit";
import { auth } from "@/auth";

// ─── Schema ─────────────────────────────────────────────────────────────────
// Mirrors `ErrorFingerprint` in `lib/error/reportError.ts`. Keep in sync —
// the validator is intentionally lax on unknown fields (catchall) because
// the client may stamp future debug context (`context: { ... }`) without
// requiring a server release.

const FingerprintSchema = z
  .object({
    scope: z.enum(["Board", "List", "Card", "Modal", "Root", "Async", "Promise", "Unknown"]),
    entityKind: z.enum(["board", "list", "card"]).optional(),
    entityId: z.string().max(128).optional(),
    message: z.string().max(2000),
    stack: z.string().max(8000).optional(),
    componentStack: z.string().max(4000).optional(),
    timestamp: z.string(),
    url: z.string().max(2048).optional(),
    userAgent: z.string().max(512).optional(),
    buildSha: z.string().max(64).optional(),
    context: z.record(z.unknown()).optional(),
  })
  .strict();

// ─── Rate-limit profile ─────────────────────────────────────────────────────
// Reuses the existing in-memory window. Errors are usually rare; the
// generous bucket (60/15min) leaves room for a buggy session to finish
// reporting itself without dropping legitimate signal.

const ERROR_REPORT_LIMIT = {
  max: 60,
  windowMs: 15 * 60 * 1000,
  keyPrefix: "rl:err",
} as const;

// ─── Handler ────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // 1. Rate limit ------------------------------------------------------------
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const limited = rateLimitResponse(ip, ERROR_REPORT_LIMIT);
  if (limited) return limited;

  // 2. Validate payload ------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Bad JSON — return 200 anyway so the client never retries.
    return NextResponse.json({ accepted: false, reason: "bad_json" }, { status: 200 });
  }

  const parsed = FingerprintSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { accepted: false, reason: "schema_error" },
      { status: 200 },
    );
  }
  const fp = parsed.data;

  // 3. Enrich from server session -------------------------------------------
  // `userId` from the body is ignored — the client can't be trusted to claim
  // an identity it doesn't have. Same logic for `tenantId` which we'd add
  // here once the auth session carries it.
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;

  // 4. Record ----------------------------------------------------------------
  // For now: a structured `console.error` line. The platform log drain
  // captures it; alerting / dashboards can grep for `event: client_error`.
  console.error(
    JSON.stringify({
      event: "client_error",
      severity: severityFor(fp.scope),
      scope: fp.scope,
      entityKind: fp.entityKind ?? null,
      entityId: fp.entityId ?? null,
      message: fp.message,
      stack: fp.stack ?? null,
      componentStack: fp.componentStack ?? null,
      url: fp.url ?? null,
      userAgent: fp.userAgent ?? null,
      buildSha: fp.buildSha ?? null,
      context: fp.context ?? null,
      userId,
      ip,
      receivedAt: new Date().toISOString(),
      clientTimestamp: fp.timestamp,
    }),
  );

  return NextResponse.json({ accepted: true }, { status: 200 });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Coarse severity tag — useful when grepping logs without parsing JSON.
 * The mapping mirrors how loud each scope is in user-facing impact:
 *   Root  / Modal     → CRITICAL  (whole-page or whole-modal failure)
 *   Board             → ERROR     (whole-board failure)
 *   List  / Card      → WARNING   (one column or one card failed)
 *   Async / Promise   → WARNING   (background, often non-fatal)
 */
function severityFor(scope: z.infer<typeof FingerprintSchema>["scope"]): string {
  switch (scope) {
    case "Root":
    case "Modal":
      return "CRITICAL";
    case "Board":
      return "ERROR";
    case "List":
    case "Card":
    case "Async":
    case "Promise":
      return "WARNING";
    default:
      return "INFO";
  }
}
