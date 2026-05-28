"use client";

// apps/web/src/features/shell/hooks/useCommandK.ts
//
// Single-source-of-truth for the Cmd/Ctrl+K keyboard shortcut.
//
// F4 wires the listener once (in SearchBar) and exposes a callback
// hook so consumers don't each re-implement key detection. F1.5
// will introduce the real command palette and replace SearchBar's
// "focus the search input" callback with `setPaletteOpen(true)`.
//
// Cross-platform handling:
//   • macOS  — metaKey (Cmd)
//   • Windows / Linux — ctrlKey
// Both keys map to the same shortcut so muscle memory carries.
//
// The hook returns nothing — registering the listener via useEffect
// is the entire contract. Callers pass an `onOpen` callback that
// fires when the shortcut is pressed.

import { useEffect, useRef } from "react";

export function useCommandK(onOpen: () => void): void {
  // Pin the latest callback in a ref so the effect can re-read on
  // every fire without re-binding the listener (which would skip a
  // tick of registration on every render).
  const callbackRef = useRef(onOpen);
  callbackRef.current = onOpen;

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (!isCmdK) return;
      // Don't hijack browser shortcuts when the user is in a text
      // input. The search bar itself focuses on Cmd+K via this hook;
      // for everything else we let the default keystroke proceed.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        // Allow `Cmd+K` inside the search input itself (it should
        // re-focus). For other inputs (workspace name field, etc.)
        // ignore so the user's typing isn't disrupted.
        if (target.getAttribute("type") !== "search") {
          return;
        }
      }
      e.preventDefault();
      // Surface a tiny telemetry breadcrumb. Any production
      // instrumentation can intercept window.console.debug.
      // eslint-disable-next-line no-console
      console.debug("[useCommandK] shortcut fired");
      callbackRef.current();
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
