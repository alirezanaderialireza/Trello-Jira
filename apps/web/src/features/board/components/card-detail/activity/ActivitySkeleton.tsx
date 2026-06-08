"use client";

// apps/web/src/features/board/components/card-detail/activity/ActivitySkeleton.tsx
//
// Animated loading placeholder for ActivityRow items.

export function ActivitySkeleton() {
  return (
    <div dir="rtl" className="space-y-4">
      {[1, 2, 3, 4, 5].map((n) => (
        <div key={n} className="flex gap-3 items-start animate-pulse">
          {/* Avatar placeholder */}
          <div className="h-8 w-8 flex-shrink-0 rounded-full bg-slate-700" />
          {/* Text lines */}
          <div className="flex-1 space-y-2 pt-1">
            <div
              className="h-3 rounded bg-slate-700"
              style={{ width: `${55 + (n % 3) * 15}%` }}
            />
            <div className="h-2.5 w-20 rounded bg-slate-700/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
