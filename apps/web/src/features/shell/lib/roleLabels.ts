// apps/web/src/features/shell/lib/roleLabels.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Centralized Persian labels for workspace and board roles.
//
// The shell renders role information in many places — sidebar workspace
// nodes, member chips in board headers, role badges in dropdowns.
// Hard-coding "OWNER" → "مالک" in each component would (a) duplicate
// strings and (b) make a future role rename a 12-file refactor.
//
// This module is the single source of truth for role display. If the
// domain `WorkspaceRole` enum gains a new variant, the TypeScript
// `Record<…, string>` typing makes the addition compile-time visible
// (the consumer must add a label, the linter complains otherwise).
//
// Convention: Persian labels are nouns (مالک = "the owner"), not
// adjectives. They read well in sentences like "شما مالک هستید" or
// in standalone badges.
// ─────────────────────────────────────────────────────────────────────────────

import type { WorkspaceRole } from "@repo/domain";

/**
 * Persian display label for each `WorkspaceRole`. Used by sidebar
 * workspace headers and the workspaces list page.
 */
export const WORKSPACE_ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: "مالک",
  ADMIN: "مدیر",
  MEMBER: "عضو",
  VIEWER: "ناظر",
};

/**
 * Board roles are a subset of workspace roles in the F1 schema —
 * boards have OWNER / ADMIN / MEMBER but no VIEWER (yet). The labels
 * are identical, so we re-use the workspace map.
 *
 * Kept as a separate alias so a future board-only role (e.g.
 * "OBSERVER") can land here without touching the workspace map.
 */
export type BoardRole = "OWNER" | "ADMIN" | "MEMBER";
export const BOARD_ROLE_LABELS: Record<BoardRole, string> = {
  OWNER: "مالک",
  ADMIN: "مدیر",
  MEMBER: "عضو",
};

/**
 * Convenience getter for workspace role display. Returns the Persian
 * label, or the input role string verbatim if it is not a known
 * `WorkspaceRole` (defensive — prevents the shell from crashing on a
 * data drift where the API returns a role we don't recognise).
 */
export function getWorkspaceRoleLabel(role: string): string {
  return (
    (role in WORKSPACE_ROLE_LABELS &&
      WORKSPACE_ROLE_LABELS[role as WorkspaceRole]) ||
    role
  );
}

/**
 * Same as above, for boards.
 */
export function getBoardRoleLabel(role: string): string {
  return (
    (role in BOARD_ROLE_LABELS && BOARD_ROLE_LABELS[role as BoardRole]) || role
  );
}
