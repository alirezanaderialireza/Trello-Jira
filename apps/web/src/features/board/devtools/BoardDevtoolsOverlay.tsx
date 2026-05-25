"use client";

// apps/web/src/features/board/devtools/BoardDevtoolsOverlay.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// Devtools overlay — minimal stub.
//
// This component used to render a 560×680px overlay with three tabs
// (mutations / fsm / logs) that probed the SyncStateMachine via:
//   - getSyncFSM().subscribe(cb)
//   - getSyncFSM().getState()
//   - getSyncFSM().getContext()
// and used a SyncState lowercase variant set ("idle", "synced",
// "catching_up", …).
//
// The SyncStateMachine class was subsequently refactored to a simpler,
// pure-actor shape that only exposes:
//   - get state(): SyncState           (uppercase: "IDLE" | "CONNECTING" | …)
//   - get history()
//   - send(message)
//   - reset()
//
// All three previously-used inspection methods (subscribe / getState /
// getContext) and the lowercase state vocabulary disappeared in that
// refactor; the overlay was never updated and consequently failed the
// production type-check:
//
//   ./src/features/board/devtools/BoardDevtoolsOverlay.tsx:20:18
//   Type error: Property 'subscribe' does not exist on type 'SyncStateMachine'.
//
// This stub keeps the public export (`BoardDevtoolsOverlay`) so the
// dynamic import inside `app/_components/DevtoolsClient.tsx`
// (gated on `process.env.NODE_ENV === "development"`) still resolves,
// but renders nothing. The full overlay should be reintroduced in a
// follow-up PR once the FSM exposes a public observation API again
// (e.g. an explicit `subscribe()` listener model or a snapshot getter
// returning { state, context }) and a stable mapping from the
// uppercase SyncState union back to display labels.
//
// Until then there is no behavioural regression: the overlay only ran
// in dev mode and was already broken at runtime against the new FSM.
// ─────────────────────────────────────────────────────────────────────────────

export function BoardDevtoolsOverlay() {
  return null;
}
