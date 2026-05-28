// apps/web/src/app/(app)/loading.tsx
//
// Persian skeleton shown while the (app) layout's server-side fetch of
// `sidebar.bootstrap` is in flight, or while a navigation between
// (app) pages is awaiting React Suspense.
//
// Mirrors the layout's footprint (TopNav h-14, Sidebar w-64 on md+,
// main flex-1) so the user perceives no layout shift when content
// arrives.

export default function AppLoading() {
  return (
    <div
      className="
        grid h-screen
        grid-cols-1 grid-rows-[56px_1fr]
        md:grid-cols-[260px_1fr]
      "
    >
      <header className="md:col-span-2 flex h-14 items-center border-b border-slate-200 bg-white px-4">
        <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
      </header>

      <aside
        className="row-start-2 hidden border-e border-slate-200 bg-slate-50 md:block"
        aria-label="در حال بارگذاری فضاهای کاری"
      >
        <div className="space-y-3 p-4">
          <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-20 animate-pulse rounded bg-slate-200" />
        </div>
      </aside>

      <main className="row-start-2 flex items-center justify-center bg-white">
        <div className="text-sm text-slate-400">در حال بارگذاری…</div>
      </main>
    </div>
  );
}
