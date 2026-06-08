"use client";

// apps/web/src/features/board/components/card-detail/CardComments.tsx
//
// Full rewrite of the F1.2.4.a placeholder stub.
//
// Container responsibilities:
//   • Reads the current session to get userId and board role
//   • Delegates all data fetching + store hydration to CommentsList
//   • Passes userId + role downward; owns no mutations directly
//
// Board role:
//   We read it from the session's boardMembership when available.
//   As a safe default we use "MEMBER" (least-privileged) so the delete
//   button is only shown to the comment author until the role is known.
//   The server is still the authoritative gate.

import { useSession } from "next-auth/react";
import { CommentsList } from "./comments/CommentsList";

interface Props {
  cardId:  string;
  boardId: string;
  /** Optional board role passed down from CardDetailModal if known. */
  role?:   string;
}

export function CardComments({ cardId, boardId, role = "MEMBER" }: Props) {
  const { data: session, status } = useSession();

  // While session is loading show a subtle spinner
  if (status === "loading") {
    return (
      <div dir="rtl" className="py-6 text-center text-sm text-slate-500">
        در حال بارگذاری...
      </div>
    );
  }

  const currentUserId = session?.user?.id ?? "";

  if (!currentUserId) {
    return (
      <div dir="rtl" className="py-6 text-center text-sm text-slate-500">
        برای مشاهده و ارسال کامنت وارد شوید.
      </div>
    );
  }

  return (
    <CommentsList
      cardId={cardId}
      boardId={boardId}
      currentUserId={currentUserId}
      role={role}
    />
  );
}
