// packages/api/src/utils/idempotency.ts
//
// Router-level idempotency wrapper.
//
// Decision (D2): clients may pass an optional `idempotencyKey: string`
// (UUID v4) on any side-effect mutation. The contract:
//
//   • If the key is missing, the body executes once with no caching.
//     Mirrors the legacy "fire-and-forget" behaviour for mutations that
//     don't need replay safety.
//   • If the key is present and we already have a stored response under
//     that key, return the cached response WITHOUT re-executing the body.
//   • Otherwise, execute the body, persist the response keyed by the
//     supplied key, and return.
//
// The store is the existing `idempotency_keys` Postgres table (schema in
// packages/db/src/schema/idempotency.ts). The on-disk column is named
// `mutation_id` for historical reasons — we accept the public-facing name
// `idempotencyKey` and translate at the boundary.
//
// Tx semantics:
//   The save runs against `ctx.infra.db`, which under
//   `protectedProcedure` is already the per-request RLS-enforced
//   transaction. Body + save commit atomically: if the body throws, the
//   save rolls back too and a retry will re-execute. If the body
//   succeeds but save throws, the body's writes are lost as well — that
//   is the correct atomicity contract.
//
// Limitations:
//   • Schema-version mismatches are not handled here. Callers stamp the
//     schema version they wrote; a future reader that reads a stale row
//     may want to reject + ask the client to retry. F3a.1 doesn't need
//     that yet.
//   • Concurrent requests with the same key racing on the FIRST call may
//     both execute. Mitigation is the primary-key constraint on
//     `mutationId` — the second save will throw and surface as an error.
//     For F3a.1 callers (single-tab create/update flows) this is fine.

import type { Context } from "../trpc";

/**
 * Wrap a procedure body in an idempotency check.
 *
 * @param ctx              tRPC context (must expose `repos.idempotency` and
 *                         `infra.db`).
 * @param idempotencyKey   Optional UUID v4 supplied by the client.
 * @param schemaVersion    Identifier of the response shape, e.g. "v1".
 *                         Bump on every breaking change.
 * @param body             The actual mutation body. Must be deterministic
 *                         given its inputs (otherwise replays will
 *                         surprise the caller).
 */
export async function withIdempotency<T>(
  ctx: Pick<Context, "repos" | "infra">,
  idempotencyKey: string | undefined,
  schemaVersion: string,
  body: () => Promise<T>,
): Promise<T> {
  if (!idempotencyKey) {
    return body();
  }

  const cached = await ctx.repos.idempotency.findByMutationId<T>(
    ctx.infra.db,
    idempotencyKey,
  );
  if (cached) {
    return cached.response;
  }

  const result = await body();

  await ctx.repos.idempotency.save<T>(ctx.infra.db, {
    mutationId: idempotencyKey,
    response: result,
    schemaVersion,
    createdAt: new Date(),
  });

  return result;
}
