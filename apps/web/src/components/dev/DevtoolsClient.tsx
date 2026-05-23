"use client";

// apps/web/src/components/dev/DevtoolsClient.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// Devtools client wrapper.
//
// Next.js 15+ forbids `next/dynamic({ ssr: false })` from a Server Component.
// `app/layout.tsx` IS a server component by default. This file is a client
// component (`"use client"`) that legally hosts the dynamic import and
// renders nothing in production.
//
// Keeping the lazy import means the heavy debug store + timeline UI is never
// shipped in a production bundle (Next.js code-splits the dynamic chunk and
// drops it altogether when the conditional below evaluates false at build
// time, since `process.env.NODE_ENV` is statically replaced).
// ─────────────────────────────────────────────────────────────────────────────

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

const BoardDevtoolsOverlay: ComponentType | null =
  process.env.NODE_ENV === "development"
    ? (dynamic(
        () =>
          import("../../features/board/devtools/BoardDevtoolsOverlay").then(
            (mod) => mod.BoardDevtoolsOverlay,
          ),
        { ssr: false },
      ) as ComponentType)
    : null;

export function DevtoolsClient() {
  if (!BoardDevtoolsOverlay) return null;
  return <BoardDevtoolsOverlay />;
}
