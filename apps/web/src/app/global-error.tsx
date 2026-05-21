"use client";

// apps/web/src/app/global-error.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// Next.js root-level error fallback.
//
// `global-error.tsx` is the LAST resort in the Next.js error hierarchy:
//   1. A nested `error.tsx` catches errors in its segment.
//   2. The root `app/error.tsx` catches errors not caught by a nested one.
//   3. `global-error.tsx` is the only fallback that can catch errors in
//      the root LAYOUT itself — it must render its own <html><body>.
//
// Our in-tree <RootErrorBoundary> in `layout.tsx` covers the common case
// (children render-time errors, async leakage). This file kicks in only
// when the layout itself fails — e.g. a SessionProvider crash, a faulty
// Tailwind import, or a Next.js-internal hydration error.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Best-effort log. We can't import @/lib/error/reportError safely here
    // because that module assumes the app shell mounted; instead we POST
    // the bare minimum directly. Failures are swallowed.
    if (typeof window === "undefined") return;
    try {
      void fetch("/api/errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "Root",
          message: error.message?.slice(0, 500) ?? "global-error",
          stack: error.stack?.slice(0, 2000),
          timestamp: new Date().toISOString(),
          url: window.location.href,
          userAgent: navigator.userAgent,
          context: {
            source: "next/global-error",
            digest: error.digest ?? null,
          },
        }),
        keepalive: true,
      });
    } catch {
      /* swallowed — never break the fallback UI */
    }
  }, [error]);

  return (
    <html lang="fa" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fbfbfd",
          color: "#1d1d1f",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            margin: "0 1rem",
            padding: "2rem",
            backgroundColor: "white",
            borderRadius: 16,
            boxShadow: "0 8px 30px rgba(0,0,0,0.04)",
            border: "1px solid #f0f0f0",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              backgroundColor: "#fef2f2",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1.5rem",
            }}
          >
            <svg
              width={32}
              height={32}
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
            خطای غیرمنتظره
          </h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>
            {error.message?.slice(0, 200) ||
              "بارگذاری اپلیکیشن با مشکل مواجه شد."}
          </p>

          <div
            style={{ display: "flex", gap: 12, justifyContent: "center" }}
          >
            <button
              onClick={() => reset()}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 500,
                color: "white",
                backgroundColor: "#0A2540",
                border: "none",
                cursor: "pointer",
              }}
            >
              تلاش مجدد
            </button>
            <button
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 500,
                color: "#6b7280",
                backgroundColor: "#f9fafb",
                border: "1px solid #e5e7eb",
                cursor: "pointer",
              }}
            >
              بارگذاری مجدد
            </button>
          </div>

          {error.digest && (
            <p
              style={{
                marginTop: 24,
                fontSize: 11,
                color: "#9ca3af",
                fontFamily: "monospace",
              }}
            >
              digest: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
