"use client";

// apps/web/src/app/board/[boardId]/_components/MembersTab.tsx
// Placeholder — concrete implementation (members list + invite +
// role select + remove) lands in commit 7.

import type { ActionResult } from "../_actions/_helpers";

interface Props {
  boardId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  onInviteMember: (input: {
    boardId: string;
    userId: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
  }) => Promise<ActionResult & { alreadyMember?: boolean; memberId?: string }>;
  onChangeRole: (input: {
    boardId: string;
    userId: string;
    newRole: "OWNER" | "ADMIN" | "MEMBER";
  }) => Promise<ActionResult>;
  onRemoveMember: (input: {
    boardId: string;
    userId: string;
  }) => Promise<ActionResult>;
}

export function MembersTab(_props: Props) {
  return (
    <p className="text-sm text-slate-500">
      محتوای تب «اعضا» در کامیت بعدی اضافه می‌شود.
    </p>
  );
}
