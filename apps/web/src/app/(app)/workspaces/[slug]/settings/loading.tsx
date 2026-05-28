// apps/web/src/app/(app)/workspaces/[slug]/settings/loading.tsx
//
// Skeleton rendered while the layout's getBySlug fetch is in
// flight. Mirrors the structure of the real settings layout so the
// hydrated page slots in without layout shift.

export default function SettingsLoading() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6">
          <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-7 w-1/2 animate-pulse rounded bg-slate-200" />
          <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-slate-200" />
        </header>

        {/* Tabs row */}
        <div className="flex gap-2 border-b border-slate-200">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-10 w-24 animate-pulse rounded-t-lg bg-slate-200"
            />
          ))}
        </div>

        {/* Body */}
        <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="h-5 w-1/4 animate-pulse rounded bg-slate-200" />
          <div className="h-10 animate-pulse rounded bg-slate-100" />
          <div className="h-5 w-1/4 animate-pulse rounded bg-slate-200" />
          <div className="h-24 animate-pulse rounded bg-slate-100" />
          <div className="h-5 w-1/4 animate-pulse rounded bg-slate-200" />
          <div className="h-10 animate-pulse rounded bg-slate-100" />
        </div>
      </div>
    </div>
  );
}
