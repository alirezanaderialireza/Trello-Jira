"use client";

// apps/web/src/app/board/[boardId]/_components/BackgroundTab.tsx
// Placeholder — concrete implementation (12 colors + 8 gradients,
// hover preview via --board-bg CSS variable) lands in commit 6.

import type { ActionResult } from "../_actions/_helpers";

interface Props {
  boardId: string;
  backgroundData: unknown;
  role: "OWNER" | "ADMIN" | "MEMBER";
  onSetBackground: (input: {
    boardId: string;
    backgroundData: { type: "color" | "gradient"; id: string } | null;
  }) => Promise<ActionResult>;
}

export function BackgroundTab(_props: Props) {
  return (
    <p className="text-sm text-slate-500">
      محتوای تب «پس‌زمینه» در کامیت بعدی اضافه می‌شود.
    </p>
  );
}
