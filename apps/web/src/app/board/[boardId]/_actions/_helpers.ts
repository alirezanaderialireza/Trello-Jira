// apps/web/src/app/board/[boardId]/_actions/_helpers.ts
//
// Shared helpers for the F5b board Server Actions. NOT marked
// "use server" — the file exports plain functions / types so the
// actions can pull them in without each export becoming a
// network-callable Server Action (Next.js requires every export
// from a "use server" file to be an async function).

/**
 * Persian-safe error message extraction from a thrown TRPCError or
 * any unexpected throw shape. Capped at 200 chars to keep the
 * client-side toast readable.
 */
export function persianMessage(err: unknown, fallback: string): string {
  const message = (err as { message?: unknown })?.message;
  if (typeof message === "string" && message.length > 0 && message.length < 200) {
    return message;
  }
  return fallback;
}

/**
 * Common discriminated-union result for all F5b board actions.
 * Mirrors the F5a workspace actions contract so the drawer's
 * tabs can share generic toast / refresh handling.
 */
export interface ActionResult {
  ok: boolean;
  error?: string;
}
