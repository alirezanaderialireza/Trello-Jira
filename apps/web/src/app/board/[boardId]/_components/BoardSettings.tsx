"use client";

// apps/web/src/app/board/[boardId]/_components/BoardSettings.tsx
//
// Composite Client Component that wires the F5b board settings flow:
//
//   • Renders the trigger button (gear icon) in the board header.
//   • Conditionally mounts the drawer when ?settings=<tab> is in the
//     URL (D7 — drawer payload + tab implementations only hydrate
//     when the user actually opens the drawer).
//   • Owns the URL query param (?settings=<tab>) so the drawer can
//     be closed by removing the param, links can deep-link to a
//     specific tab, and back/forward navigation works (D1).
//
// The page (Server Component) imports the Server Actions and hands
// them in as a single `actions` bag. Features under
// features/board-settings/ never reach into app/* directly — same
// boundaries discipline as F4 + F5a.
//
// Why a single component owning trigger + drawer:
//   The trigger and the drawer share the URL state (open/close +
//   active tab). Splitting into two files would force both to read
//   the same useSearchParams hook and stay in sync — extra work for
//   no gain, and risks a flash where one half sees the URL update
//   before the other.

import { useRouter, useSearchParams } from "next/navigation";
import { Settings } from "lucide-react";
import { lazy, Suspense } from "react";

import type { BoardSettingsActions, BoardSettingsTab } from "./BoardSettingsDrawer";
import { VALID_BOARD_SETTINGS_TABS } from "./BoardSettingsDrawer";

// Lazy-load the drawer so the (heavier) tab implementations only
// hydrate when the user actually opens the drawer. The trigger
// button + URL-state wiring stays in the main bundle.
const BoardSettingsDrawer = lazy(() =>
  import("./BoardSettingsDrawer").then((mod) => ({ default: mod.BoardSettingsDrawer })),
);

interface Props {
  boardId: string;
  actions: BoardSettingsActions;
  /** True when the current viewer cannot reach the settings drawer
   *  (e.g. board MEMBER role). The trigger stays hidden in that
   *  case to avoid a noisy "you can't open this" path. */
  hidden?: boolean;
}

const QUERY_PARAM = "settings";
const DEFAULT_TAB: BoardSettingsTab = "about";

export function BoardSettings({ boardId, actions, hidden = false }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabFromUrl = searchParams.get(QUERY_PARAM);
  const activeTab: BoardSettingsTab | null =
    tabFromUrl !== null && (VALID_BOARD_SETTINGS_TABS as readonly string[]).includes(tabFromUrl)
      ? (tabFromUrl as BoardSettingsTab)
      : null;
  const isOpen = activeTab !== null;

  const writeTab = (tab: BoardSettingsTab | null) => {
    // Build the next search-params string while preserving any other
    // query params the page might use (e.g. card focus). Use
    // router.replace (not push) so each tab switch doesn't pollute
    // browser history — only the open / close transitions are
    // pushed via the trigger / backdrop click below.
    const params = new URLSearchParams(searchParams.toString());
    if (tab === null) {
      params.delete(QUERY_PARAM);
    } else {
      params.set(QUERY_PARAM, tab);
    }
    const queryString = params.toString();
    const target = queryString ? `?${queryString}` : "";
    router.replace(`${typeof window !== "undefined" ? window.location.pathname : ""}${target}`);
  };

  const handleOpen = () => writeTab(DEFAULT_TAB);
  const handleClose = () => writeTab(null);
  const handleTabChange = (tab: BoardSettingsTab) => writeTab(tab);

  if (hidden) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="تنظیمات بورد"
        title="تنظیمات بورد"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <Settings className="h-5 w-5" aria-hidden="true" />
      </button>

      {isOpen && (
        <Suspense fallback={null}>
          <BoardSettingsDrawer
            boardId={boardId}
            activeTab={activeTab!}
            actions={actions}
            onClose={handleClose}
            onTabChange={handleTabChange}
          />
        </Suspense>
      )}
    </>
  );
}
