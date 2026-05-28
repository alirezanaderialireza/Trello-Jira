"use client";

// apps/web/src/app/board/[boardId]/_components/DangerTab.tsx
// Placeholder — concrete implementation lands in the next commit.

import type { ActionResult } from "../_actions/_helpers";

interface Props {
  boardId: string;
  title: string;
  archivedAt: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  onArchive: (input: { boardId: string }) => Promise<ActionResult>;
  onUnarchive: (input: { boardId: string }) => Promise<ActionResult>;
  onDelete: (input: { boardId: string }) => Promise<ActionResult>;
  onCloseDrawer: () => void;
}

export function DangerTab(_props: Props) {
  return (
    <p className="text-sm text-slate-500">
      محتوای تب «ناحیهٔ خطر» در کامیت بعدی اضافه می‌شود.
    </p>
  );
}
