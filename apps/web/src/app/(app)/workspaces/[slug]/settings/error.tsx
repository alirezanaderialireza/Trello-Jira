"use client";

// apps/web/src/app/(app)/workspaces/[slug]/settings/error.tsx
//
// Client error boundary scoped to the settings sub-tree. Catches
// uncaught throws inside the layout / pages — the role-gate
// redirects are NOT errors (they short-circuit cleanly), so this
// boundary should rarely trip in practice.
//
// The error message comes from the upstream throw (often a Persian
// tRPC error). We surface it verbatim, capped at 200 chars, with a
// retry button that re-runs the failed Server Component segment.

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function SettingsError({ error, reset }: ErrorProps) {
  const message =
    typeof error?.message === "string" && error.message.length > 0
      ? error.message.slice(0, 200)
      : "خطای ناشناخته در بارگذاری تنظیمات.";

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-lg sm:p-8">
        <h2 className="text-lg font-bold text-red-900">
          خطایی در بارگذاری تنظیمات رخ داد
        </h2>
        <p dir="auto" className="mt-3 text-sm leading-7 text-slate-700">
          {message}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          تلاش مجدد
        </button>
      </div>
    </div>
  );
}
