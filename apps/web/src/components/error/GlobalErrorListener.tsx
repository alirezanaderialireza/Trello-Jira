"use client";

// apps/web/src/components/error/GlobalErrorListener.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// React error boundaries only catch ERRORS THROWN DURING RENDER. They do
// NOT catch:
//
//   • Async functions in `useEffect` that reject
//   • Bare `Promise.then(...)` chains without `.catch`
//   • Errors thrown inside `setTimeout` / `setInterval` callbacks
//   • Event-handler errors that happen on the next macrotask
//   • Errors from third-party scripts loaded into the page
//
// The browser fires `window.error` and `window.unhandledrejection` for
// most of these. This component subscribes to both and forwards them to
// `reportError` so they show up alongside boundary-caught errors in the
// observability pipeline.
//
// Usage: mount once at the app root (apps/web/src/app/layout.tsx). It
// renders nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { buildFingerprint, reportError } from "@/lib/error/reportError";

export function GlobalErrorListener() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // ── window.error ──────────────────────────────────────────────────────
    // Fired for uncaught JS exceptions. We DO NOT call preventDefault
    // here — the browser's default behaviour (logging + devtools) is
    // still useful, and suppressing it can hide real bugs.
    const onError = (event: ErrorEvent) => {
      const err = event.error ?? new Error(event.message || "Unknown error");
      reportError(
        buildFingerprint(err, "Async", {
          context: {
            source: "window.error",
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          },
        }),
      );
    };

    // ── window.unhandledrejection ─────────────────────────────────────────
    // Fired when a Promise rejects without a `.catch`. Most async bugs
    // surface here. `event.reason` is whatever was thrown — typically
    // an Error, sometimes a string or a plain object.
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportError(
        buildFingerprint(event.reason, "Promise", {
          context: { source: "window.unhandledrejection" },
        }),
      );
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
