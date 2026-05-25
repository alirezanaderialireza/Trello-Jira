// apps/web/src/features/board/actions/responseTypes.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Public types and type guards for ActionResponse<T>.
//
// Lives in its own module — separate from board.actions.ts — because
// board.actions.ts carries a top-level "use server" directive. With that
// directive every export from the module is treated as a Server Action,
// which Next.js requires to be an async function:
//
//   Error: Server Actions must be async functions.
//     export function isActionFailure<T>(...) is response is ActionFailure {
//                     ^^^^^^^^^^^^^^^
//
// Synchronous type guards therefore can't live next to the actions. This
// file is a plain module — no "use server" — so the guards and the type
// re-exports are free to be imported from both client and server code.
// ─────────────────────────────────────────────────────────────────────────────

export type ActionFailure = {
  success: false;
  code: string;
  message: string;
  isRetryable: boolean;
};

export type ActionSuccess<T> = {
  success: true;
  data: T;
};

export type ActionResponse<T> = ActionSuccess<T> | ActionFailure;

// ============================================================================
// Type Guards
// ─────────────────────────────────────────────────────────────────────────────
// Why these exist: Next 16 / TS-latest fail to narrow ActionResponse<T> from
// a plain `if (!result.success)` check at several call sites — the union's
// generic parameter can defeat the flow analyser depending on how the
// response was returned (await chain, async wrapping, …). The result is:
//
//   Property 'message' does not exist on type 'ActionResponse<...>'.
//
// even though the runtime branch is correct. The guards' return-type
// predicate (`response is ActionFailure`) makes the narrowing explicit and
// type-safe, while the runtime check is still just one equality.
// ============================================================================

export function isActionFailure<T>(
  response: ActionResponse<T>,
): response is ActionFailure {
  return response.success === false;
}

export function isActionSuccess<T>(
  response: ActionResponse<T>,
): response is ActionSuccess<T> {
  return response.success === true;
}
