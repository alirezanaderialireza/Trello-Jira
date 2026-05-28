"use client";

// apps/web/src/app/(app)/error.tsx
//
// Persian error boundary for the (app) layout. Catches anything that
// escapes the layout's defensive try/catch around `sidebar.bootstrap`
// — most realistically a runtime crash inside a child page's
// rendering or a tRPC mutation that throws after navigation.
//
// Per the Next App Router contract, this MUST be a Client Component
// (it receives `reset()` as a prop, which is a callback). It does NOT
// override the root error.tsx — that one catches errors that fire
// before the (app) layout itself mounts.

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error to the runtime telemetry so it lands in the
    // observability pipeline. The root GlobalErrorListener also picks
    // up unhandled rejections, but boundary errors are caught by React
    // before they reach the window event handler — so we log here
    // explicitly.
    //
    // Using `console.error` is the canonical Next.js convention for
    // error boundaries; the project's reportError helper is wired
    // elsewhere to consume console errors in dev.
    console.error("[(app) error boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-6">
      <div className="max-w-md text-center">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">
          خطایی رخ داد
        </h2>
        <p className="mb-6 text-sm text-slate-600">
          متأسفانه در بارگذاری این صفحه مشکلی پیش آمد. لطفاً دوباره تلاش کنید.
        </p>
        <button
          type="button"
          onClick={reset}
          className="
            inline-flex items-center justify-center rounded-md
            bg-blue-600 px-4 py-2 text-sm font-medium text-white
            hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-blue-600 focus-visible:ring-offset-2
          "
        >
          تلاش مجدد
        </button>
      </div>
    </div>
  );
}
