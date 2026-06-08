// apps/web/src/components/users/AssigneeAvatarStack.tsx
//
// Shared component (src/components/users/) — imported by both
// CardItem (features/board) and CardAssignees panel (features/board/
// card-detail). Lives in shared territory per D21 to satisfy the
// boundaries linter's cross-feature ban.
//
// Props:
//   assigneeIds — ordered array of userIds (D7: assignedAt asc → RTL right)
//   members     — boardMembers cache Record<userId, BoardMemberDto>
//   limit       — max avatars shown before "+N" chip (default 4)
//   size        — "xs" | "sm"
//
// RTL: avatars overlap left over right (older assignees to the right
// in RTL layout). Each avatar stacks with negative margin-start.

import { UserAvatar } from "./UserAvatar";
import type { BoardMemberDto } from "@/lib/members/types";

interface Props {
  assigneeIds:  readonly string[];
  members:      Record<string, BoardMemberDto>;
  limit?:       number;
  size?:        "xs" | "sm";
  className?:   string;
}

export function AssigneeAvatarStack({
  assigneeIds,
  members,
  limit = 4,
  size  = "xs",
  className = "",
}: Props) {
  if (assigneeIds.length === 0) return null;

  const visible      = assigneeIds.slice(0, limit);
  const overflowCount = Math.max(0, assigneeIds.length - limit);

  // Build tooltip listing all names.
  const allNames = assigneeIds
    .map((id) => members[id]?.displayName ?? id.slice(0, 8))
    .join("، ");

  return (
    <div
      dir="ltr"
      title={allNames}
      aria-label={`مسئولین: ${allNames}`}
      className={`inline-flex items-center ${className}`}
    >
      {visible.map((userId, idx) => {
        const member = members[userId];
        return (
          <span
            key={userId}
            className="inline-flex"
            style={{ marginLeft: idx === 0 ? 0 : (size === "xs" ? -8 : -10) }}
          >
            <UserAvatar
              displayName={member?.displayName}
              avatarUrl={member?.avatarUrl}
              size={size}
              className="ring-2 ring-slate-800"
            />
          </span>
        );
      })}

      {overflowCount > 0 && (
        <span
          className={`inline-flex flex-shrink-0 items-center justify-center rounded-full bg-slate-600 font-medium leading-none text-slate-200 ring-2 ring-slate-800 ${
            size === "xs" ? "h-6 w-6 text-[9px] -ms-2" : "h-8 w-8 text-[10px] -ms-2.5"
          }`}
          aria-label={`${overflowCount.toLocaleString("fa-IR")} نفر دیگر`}
        >
          +{overflowCount.toLocaleString("fa-IR")}
        </span>
      )}
    </div>
  );
}
