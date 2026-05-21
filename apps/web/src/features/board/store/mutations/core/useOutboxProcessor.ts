// apps/web/src/features/board/store/mutations/core/useOutboxProcessor.ts
//
// ============================================================================
// 🪝 useOutboxProcessor — React Lifecycle Bridge for OutboxProcessor
// ============================================================================
//
// Responsibility:
// ───────────────
// OutboxProcessor is a pure class with no React dependencies.
// This hook mounts it into the React component tree so it starts/stops
// in sync with the board session.
//
// Usage:
// ──────
//   // In BoardPage (after boardRealtimeClient.configure() has been called)
//   useOutboxProcessor();
//
// The hook must be called inside a component that is mounted for the full
// duration of a board session — i.e., BoardPage is the right place.
//
// retryFn injection:
// ──────────────────
// The retryFn is injected into boardRealtimeClient.configure() once at
// app bootstrap (in BoardPage or a layout component), before this hook runs.
// This hook itself does not need to know about the retry logic.
// ============================================================================

"use client";

import { useEffect, useRef } from "react";
import { boardRealtimeClient } from "../../api/realtime/boardRealtimeClient";
import type { DeadLetterEntry } from "../../api/realtime/outboxProcessor";

// ============================================================================
// ⚙️ Config
// ============================================================================

interface UseOutboxProcessorOptions {
  /** Called whenever a mutation enters the dead-letter queue */
  onDlqEntry?: (entry: DeadLetterEntry) => void;
}

// ============================================================================
// 🪝 Hook
// ============================================================================

export function useOutboxProcessor(options?: UseOutboxProcessorOptions): void {
  const onDlqEntryRef = useRef(options?.onDlqEntry);

  // Keep the ref current without re-running the effect
  useEffect(() => {
    onDlqEntryRef.current = options?.onDlqEntry;
  });

  useEffect(() => {
    // Subscribe to realtime client events so we can detect DLQ entries
    const unsub = boardRealtimeClient.subscribe((event) => {
      if (event.type === "dlq_entry_added") {
        onDlqEntryRef.current?.(event.entry);
      }
    });

    // Cleanup: unsubscribe from client events when the component unmounts.
    // The OutboxProcessor itself is stopped by boardRealtimeClient.disconnect()
    // which is called in BoardPage's useEffect cleanup — so we do NOT stop
    // it here to avoid double-stop races.
    return unsub;
  }, []);
  // No deps: effect runs once on mount, cleans up on unmount.
}
