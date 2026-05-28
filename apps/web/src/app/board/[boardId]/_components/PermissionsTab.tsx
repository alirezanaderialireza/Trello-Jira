"use client";

// apps/web/src/app/board/[boardId]/_components/PermissionsTab.tsx
// Placeholder — concrete implementation lands in the next commit.

import type { ActionResult } from "../_actions/_helpers";

interface Props {
  boardId: string;
  visibility: "workspace" | "private" | "public";
  role: "OWNER" | "ADMIN" | "MEMBER";
  onUpdateVisibility: (input: {
    boardId: string;
    visibility: "workspace" | "private" | "public";
  }) => Promise<ActionResult>;
}

export function PermissionsTab(_props: Props) {
  return (
    <p className="text-sm text-slate-500">
      محتوای تب «دسترسی‌ها» در کامیت بعدی اضافه می‌شود.
    </p>
  );
}
