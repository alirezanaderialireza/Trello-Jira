// apps/web/src/lib/members/types.ts
//
// Shared type definitions for board member display data.
// Lives in lib/ (shared territory) so both shared components
// (AssigneeAvatarStack, CardAssigneesBadge) and feature components
// (AssigneePicker, CardAssignees) can import without violating the
// boundaries linter's feature→feature and shared→feature rules.
//
// The Zustand store (useBoardStore.ts) also imports this type for the
// boardMembers slice.

export interface BoardMemberDto {
  userId:      string;
  role:        string; // "OWNER" | "ADMIN" | "MEMBER"
  displayName: string;
  avatarUrl:   string | null;
  email:       string;
}
