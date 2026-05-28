"use client";

// apps/web/src/app/board/[boardId]/_components/AboutTab.tsx
//
// Placeholder — concrete implementation lands in the next commit.
// The drawer shell already imports this name; shipping a stub here
// keeps the build green between the shell commit and the tab-content
// commit, and makes the intermediate diff readable.

import type { ActionResult } from "../_actions/_helpers";

interface Props {
  boardId: string;
  initialTitle: string;
  description: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  onRename: (input: { boardId: string; title: string }) => Promise<ActionResult>;
}

export function AboutTab(_props: Props) {
  return (
    <p className="text-sm text-slate-500">
      محتوای تب «درباره» در کامیت بعدی اضافه می‌شود.
    </p>
  );
}
