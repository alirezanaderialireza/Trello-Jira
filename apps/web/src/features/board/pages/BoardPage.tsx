// apps/web/src/features/board/pages/BoardPage.tsx
//
// ⚠️  DEPRECATED — This file is no longer used.
//
// The board page is now:
//   apps/web/src/app/board/[boardId]/page.tsx   (RSC router entry)
//     → features/board/components/BoardView.tsx  (client component, mounts FSM)
//
// BoardView.tsx now mounts useSyncOrchestrator() which handles:
//   - WebSocket connection via boardSocketClient
//   - SyncStateMachine lifecycle
//   - MutationLifecycleManager
//   - Full resync via projectionRebuildTooling
//
// This file is kept to avoid breaking any stale imports.
// Delete after confirming no external references.

export {};
