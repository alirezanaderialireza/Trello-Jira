// apps/web/src/features/shell/store/uiPreferencesStore.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Client-side UI preferences for the app shell.
//
// Per architecture section 0.1, we split state ownership between three
// homes:
//
//   • URL  — workspace/board identity and the actively-viewed tab.
//            Owned by Next.js routing.
//   • DB   — locale, timezone, theme, anything that should sync
//            across devices. Owned by `users.preferences` JSONB and
//            mutated via the userProfile.updatePreferences procedure.
//   • This store — purely transient UI state that has no business
//            crossing devices. Sidebar collapse, which workspaces the
//            user expanded in the sidebar tree, which TopNav popover
//            is open. These are session-local affordances, not
//            preferences in the deep sense.
//
// `persist` middleware writes to `localStorage` so a sidebar expand
// state survives a page reload, but it does NOT survive a fresh login
// on a different device — which is the right invariant for UI state.
//
// `expandedWorkspaceIds` is stored as a `string[]` rather than a
// `Set<string>` because Set instances do not survive JSON
// serialisation. The selectors below convert at the boundary.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type SidebarSection = "workspaces" | "starred" | "recent";

interface UiPreferencesState {
  /** True when the sidebar is collapsed to icon-only on desktop. */
  sidebarCollapsed: boolean;

  /**
   * IDs of workspaces the user has expanded in the sidebar tree.
   * Persisted across reloads but not across devices.
   */
  expandedWorkspaceIds: string[];

  /**
   * Currently-open accordion section in the sidebar. F4 ships with
   * three sections and only one is visually open at a time.
   */
  openSection: SidebarSection;
}

interface UiPreferencesActions {
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

  isWorkspaceExpanded: (workspaceId: string) => boolean;
  toggleWorkspaceExpanded: (workspaceId: string) => void;
  setWorkspaceExpanded: (workspaceId: string, expanded: boolean) => void;

  setOpenSection: (section: SidebarSection) => void;
}

type UiPreferencesStore = UiPreferencesState & UiPreferencesActions;

const STORAGE_KEY = "trello-os.ui-preferences";

// Schema version. Bump when the persisted shape changes incompatibly
// (e.g. adding a non-optional field) so clients with stale storage
// don't crash on load.
const STORAGE_VERSION = 1;

export const useUiPreferencesStore = create<UiPreferencesStore>()(
  persist(
    (set, get) => ({
      // ── Initial state ───────────────────────────────────────────────────
      sidebarCollapsed: false,
      expandedWorkspaceIds: [],
      openSection: "workspaces",

      // ── Actions ─────────────────────────────────────────────────────────
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      isWorkspaceExpanded: (workspaceId) =>
        get().expandedWorkspaceIds.includes(workspaceId),

      toggleWorkspaceExpanded: (workspaceId) =>
        set((state) => {
          const exists = state.expandedWorkspaceIds.includes(workspaceId);
          if (exists) {
            return {
              expandedWorkspaceIds: state.expandedWorkspaceIds.filter(
                (id) => id !== workspaceId,
              ),
            };
          }
          return {
            expandedWorkspaceIds: [...state.expandedWorkspaceIds, workspaceId],
          };
        }),

      setWorkspaceExpanded: (workspaceId, expanded) =>
        set((state) => {
          const exists = state.expandedWorkspaceIds.includes(workspaceId);
          if (expanded && !exists) {
            return {
              expandedWorkspaceIds: [...state.expandedWorkspaceIds, workspaceId],
            };
          }
          if (!expanded && exists) {
            return {
              expandedWorkspaceIds: state.expandedWorkspaceIds.filter(
                (id) => id !== workspaceId,
              ),
            };
          }
          return state;
        }),

      setOpenSection: (section) => set({ openSection: section }),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Only persist user-visible UI state. The functions are not
      // serialisable (Zustand strips them automatically, but listing
      // explicitly documents the contract).
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        expandedWorkspaceIds: state.expandedWorkspaceIds,
        openSection: state.openSection,
      }),
    },
  ),
);
