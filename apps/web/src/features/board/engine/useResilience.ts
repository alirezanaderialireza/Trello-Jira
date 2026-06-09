"use client";

// apps/web/src/features/board/engine/useResilience.ts
//
// Phase 1.3 (F1.3.4) — the resilience engine.
//
// Owns the "dangerous edges": the virtualization drag-trap flag, and the
// tab-lifecycle flush hook point. It is intentionally conservative — it never
// drops in-flight mutations (those are already tracked by the store's
// pendingMutations, the MutationLifecycleManager, and the outbox processor,
// each of which cleans up via its own hook). This engine only manages the
// resources IT creates, and removes them on unmount.
//
// ── Virtualization trap (D5) ─────────────────────────────────────────────────
// `boardDragState` is a module-level singleton flag. While a drag is active it
// is `true`. A drag-aware VirtualizedBoard/VirtualizedListColumn reads it to
// widen its overscan window so the in-flight (flying) card is never unmounted
// mid-drag. The flag lives here (not in React state) so the virtualization
// renderer can read it synchronously during its scroll math without a prop
// drill or a re-render dependency.
//
// NOTE: virtualization is not yet wired into the canvas (VirtualizedBoard does
// not currently integrate dnd-kit's SortableContext — see
// board-engine-conventions.md "Parked"). This flag is the ready hook point for
// when that integration lands.

import { useEffect } from "react";

/** Shared drag flag for the virtualization overscan trap (read synchronously). */
export const boardDragState: { isDragging: boolean } = { isDragging: false };

export function useResilience(_boardId: string, isDragging: boolean): void {
  // Publish the live drag flag for the virtualization renderer.
  useEffect(() => {
    boardDragState.isDragging = isDragging;
  }, [isDragging]);

  // Tab-lifecycle flush hook point + listener cleanup.
  useEffect(() => {
    if (typeof window === "undefined") return;

    // On hide/unload we do NOT mutate or drop pending state: the optimistic
    // mutations are already durable in the store + lifecycle manager + outbox
    // processor, which survive a tab switch and replay on reconnect. This
    // handler is the single, documented seam where an explicit durable flush
    // (e.g. forcing the outbox to drain to IndexedDB) would be invoked once
    // that API is exposed — kept as a no-op today to avoid racing the
    // processor or losing data.
    const onHide = () => {
      /* best-effort flush seam — intentionally non-destructive (see above) */
    };

    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);

    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      // Reset the trap flag so a remounted board never inherits a stale "true".
      boardDragState.isDragging = false;
    };
  }, []);
}
