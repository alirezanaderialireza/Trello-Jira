// apps/web/src/components/cards/CardAssigneesBadge.tsx
//
// Shared badge (src/components/cards/) showing the assignee avatar stack
// on CardItem preview. Lives in shared territory per D21 so CardItem
// (features/board) can import it without triggering the boundaries linter.
//
// Renders nothing when assigneeIds.length === 0.

import { AssigneeAvatarStack } from "@/components/users/AssigneeAvatarStack";
import type { BoardMemberDto } from "@/features/board/store/useBoardStore";

interface Props {
  assigneeIds: readonly string[];
  members:     Record<string, BoardMemberDto>;
  className?:  string;
}

export function CardAssigneesBadge({ assigneeIds, members, className = "" }: Props) {
  if (assigneeIds.length === 0) return null;

  return (
    <AssigneeAvatarStack
      assigneeIds={assigneeIds}
      members={members}
      limit={4}
      size="xs"
      className={className}
    />
  );
}
