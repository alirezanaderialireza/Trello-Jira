"use client";

// apps/web/src/features/shell/sidebar/PendingInvitationsBadge.tsx
//
// Small "X دعوت در انتظار" indicator at the top of the sidebar. Links
// to /invitations (which doesn't exist yet — Phase 1.2 will ship the
// list page; for now Next.js handles the 404 gracefully).
//
// Renders nothing if there are no pending invitations — empty space
// is better than a "0 دعوت" badge that adds visual noise.

import Link from "next/link";
import { Mail } from "lucide-react";

interface PendingInvitationsBadgeProps {
  count: number;
}

export function PendingInvitationsBadge({ count }: PendingInvitationsBadgeProps) {
  if (count <= 0) return null;

  return (
    <Link
      href="/invitations"
      className="
        flex items-center justify-between gap-2 rounded-md
        bg-blue-50 px-2 py-1.5 text-sm text-blue-900
        hover:bg-blue-100
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
      "
    >
      <span className="flex items-center gap-2">
        <Mail className="h-4 w-4" aria-hidden="true" />
        <span>دعوت در انتظار</span>
      </span>
      <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
        {count.toLocaleString("fa-IR")}
      </span>
    </Link>
  );
}
