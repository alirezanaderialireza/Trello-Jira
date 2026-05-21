"use client";

// Client-only wrapper for the dev-mode Board devtools overlay.
//
// `next/dynamic` with `ssr: false` is no longer allowed in Server Components
// in Next.js 16 (Turbopack). Moving the dynamic import into this Client
// Component keeps the dev-only overlay tree-shakeable in production while
// satisfying the new constraint.

import dynamic from "next/dynamic";

const BoardDevtoolsOverlay =
  process.env.NODE_ENV === "development"
    ? dynamic(
        () =>
          import(
            "../../features/board/devtools/BoardDevtoolsOverlay"
          ).then((mod) => mod.BoardDevtoolsOverlay),
        { ssr: false },
      )
    : null;

export function DevtoolsLoader() {
  if (!BoardDevtoolsOverlay) return null;
  return <BoardDevtoolsOverlay />;
}
