"use client";

// apps/web/src/features/board/components/card-detail/CardComments.tsx
//
// ⚠️  STUB — will be fully rewritten in F1.2.4.b (CardComments UI).
//
// This file is intentionally left as a minimal placeholder.
// The previous stub called non-existent procedures (getByCard,
// delete without boardId / idempotencyKey) which crash at runtime.
//
// TODO F1.2.4.b:
//   • Replace raw tRPC calls with boardApi.listComments + Zustand store
//   • Use useAddComment / useUpdateComment / useDeleteComment hooks
//   • Full Persian UI matching the Trello/Jira comment UX
//   • Hydrate store via synthetic comment.created envelopes (pattern:
//     CardChecklists.tsx from F1.2.3.b)
//   • Cursor-based pagination with "بارگذاری بیشتر" CTA
//   • Inline edit for author's own comments (useUpdateComment)

interface Props {
  cardId:  string;
  boardId: string;
}

export function CardComments({ cardId, boardId }: Props) {
  // Intentionally unused — suppresses TS "unused variable" while keeping
  // the props interface intact for F1.2.4.b wiring.
  void cardId;
  void boardId;

  return (
    <div dir="rtl" className="py-4 text-center text-sm text-slate-500">
      بارگذاری کامنت‌ها در فاز ۱.۲.۴.b انجام می‌شود.
    </div>
  );
}
