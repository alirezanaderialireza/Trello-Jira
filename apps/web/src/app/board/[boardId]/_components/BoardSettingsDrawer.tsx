"use client";

// apps/web/src/app/board/[boardId]/_components/BoardSettingsDrawer.tsx
//
// The five-tab drawer that hosts the F5b board settings UX.
//
// State ownership:
//   • Open/close + active tab are URL-driven (parent BoardSettings
//     owns the ?settings=<tab> query param). This component only
//     receives `activeTab` and `onClose` / `onTabChange` callbacks.
//   • Board metadata (title, visibility, backgroundData,
//     archivedAt, role) is fetched lazily via tRPC react-query. The
//     drawer pulls it once on mount and re-fetches after every
//     successful mutation via utils.invalidate.
//
// Layout:
//   • Desktop (>= 768px): right-edge slide-in, 400px wide,
//     full-height. Backdrop covers the rest of the viewport.
//   • Mobile (< 768px): bottom-sheet, full-width, ~85vh height,
//     translateY animation.
//
// Accessibility:
//   • role="dialog" aria-modal="true" — focus is trapped inside
//     while open (basic Tab-cycling; the user's refinement deferred
//     a focus-trap library to polish).
//   • Backdrop click + Escape key both close.
//   • Focus moves to the first tab button on open.

import { useEffect, useRef } from "react";
import { trpc } from "../../../../utils/trpc";
import { X } from "lucide-react";

import type { ActionResult } from "../_actions/_helpers";

import { AboutTab } from "./AboutTab";
import { BackgroundTab } from "./BackgroundTab";
import { DangerTab } from "./DangerTab";
import { LabelsTab } from "./LabelsTab";
import { MembersTab } from "./MembersTab";
import { PermissionsTab } from "./PermissionsTab";

// ─────────────────────────────────────────────────────────────────────────────
// Public types — re-exported by BoardSettings.tsx for the page-level wiring.
// ─────────────────────────────────────────────────────────────────────────────

export const VALID_BOARD_SETTINGS_TABS = [
  "about",
  "members",
  "labels",
  "background",
  "permissions",
  "danger",
] as const;

export type BoardSettingsTab = (typeof VALID_BOARD_SETTINGS_TABS)[number];

export interface BoardSettingsActions {
  onRename: (input: { boardId: string; title: string }) => Promise<ActionResult>;
  onUpdateDescription: (input: {
    boardId: string;
    description: string | null;
  }) => Promise<ActionResult>;
  onArchive: (input: { boardId: string }) => Promise<ActionResult>;
  onUnarchive: (input: { boardId: string }) => Promise<ActionResult>;
  onDelete: (input: { boardId: string }) => Promise<ActionResult>;
  onRestore: (input: { boardId: string }) => Promise<ActionResult>;
  onSetBackground: (input: {
    boardId: string;
    backgroundData: { type: "color" | "gradient"; id: string } | null;
  }) => Promise<ActionResult>;
  onUpdateVisibility: (input: {
    boardId: string;
    visibility: "workspace" | "private" | "public";
  }) => Promise<ActionResult>;
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

interface Props {
  boardId: string;
  activeTab: BoardSettingsTab;
  actions: BoardSettingsActions;
  onClose: () => void;
  onTabChange: (tab: BoardSettingsTab) => void;
}

const TAB_LABELS: Record<BoardSettingsTab, string> = {
  about: "درباره",
  members: "اعضا",
  labels: "برچسب‌ها",
  background: "پس‌زمینه",
  permissions: "دسترسی‌ها",
  danger: "ناحیهٔ خطر",
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function BoardSettingsDrawer({
  boardId,
  activeTab,
  actions,
  onClose,
  onTabChange,
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Fetch board settings (title, visibility, backgroundData,
  // archivedAt, role). The drawer is responsible for refreshing
  // this after every mutation via the per-tab utils.invalidate
  // calls (the React Query cache is keyed by boardId so all five
  // tabs see the fresh data automatically).
  const settingsQuery = trpc.v1.public.boardManagement.getBoardSettings.useQuery(
    { boardId },
    { staleTime: 30_000 },
  );

  // Move focus to the close button on open so screen readers
  // announce the dialog. Restoring focus to the trigger on close is
  // handled by Next's router behaviour + the trigger's tabIndex.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="board-settings-drawer-title"
      className="fixed inset-0 z-50"
    >
      {/* Backdrop — click to close. Tap-friendly on mobile thanks to */}
      {/* `touch-manipulation` (faster tap response on iOS).         */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 transition-opacity touch-manipulation"
      />

      {/* Panel — desktop: right-edge slide-in 400px; mobile: bottom-sheet. */}
      <div
        className="
          absolute bottom-0 start-0 end-0 max-h-[85vh] rounded-t-2xl bg-white shadow-2xl
          md:start-auto md:end-0 md:top-0 md:bottom-0 md:max-h-none md:w-[400px] md:rounded-none md:rounded-s-2xl
          flex flex-col
        "
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2
            id="board-settings-drawer-title"
            className="text-base font-bold text-slate-900"
          >
            تنظیمات بورد
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="بستن تنظیمات بورد"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Tabs nav */}
        <nav
          aria-label="تب‌های تنظیمات بورد"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-3"
        >
          {VALID_BOARD_SETTINGS_TABS.map((tab) => {
            const isActive = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onTabChange(tab)}
                aria-current={isActive ? "page" : undefined}
                className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </nav>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {settingsQuery.isLoading ? (
            <DrawerLoading />
          ) : settingsQuery.isError ? (
            <DrawerError onRetry={() => settingsQuery.refetch()} />
          ) : settingsQuery.data ? (
            <ActiveTabContent
              activeTab={activeTab}
              boardId={boardId}
              settings={settingsQuery.data}
              actions={actions}
              onClose={onClose}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface BoardSettingsData {
  id: string;
  title: string;
  description: string | null;
  visibility: "workspace" | "private" | "public";
  backgroundData: unknown;
  archivedAt: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  workspaceId: string;
}

function ActiveTabContent({
  activeTab,
  boardId,
  settings,
  actions,
  onClose,
}: {
  activeTab: BoardSettingsTab;
  boardId: string;
  settings: BoardSettingsData;
  actions: BoardSettingsActions;
  onClose: () => void;
}) {
  switch (activeTab) {
    case "about":
      return (
        <AboutTab
          boardId={boardId}
          initialTitle={settings.title}
          description={settings.description}
          role={settings.role}
          onRename={actions.onRename}
          onUpdateDescription={actions.onUpdateDescription}
        />
      );
    case "members":
      return (
        <MembersTab
          boardId={boardId}
          workspaceId={settings.workspaceId}
          role={settings.role}
          onInviteMember={actions.onInviteMember}
          onChangeRole={actions.onChangeRole}
          onRemoveMember={actions.onRemoveMember}
        />
      );
    case "labels":
      // F1.2.1.b — labels tab. Owns its own data fetch + mutation
      // wiring; takes only boardId + role from the drawer because
      // labels mutations route through optimistic client hooks
      // (useCreateLabel / useUpdateLabel / useDeleteLabel) instead of
      // the BoardSettingsActions Server Action prop bag.
      return <LabelsTab boardId={boardId} role={settings.role} />;
    case "background":
      return (
        <BackgroundTab
          boardId={boardId}
          backgroundData={settings.backgroundData}
          role={settings.role}
          onSetBackground={actions.onSetBackground}
        />
      );
    case "permissions":
      return (
        <PermissionsTab
          boardId={boardId}
          visibility={settings.visibility}
          role={settings.role}
          onUpdateVisibility={actions.onUpdateVisibility}
        />
      );
    case "danger":
      return (
        <DangerTab
          boardId={boardId}
          title={settings.title}
          archivedAt={settings.archivedAt}
          role={settings.role}
          onArchive={actions.onArchive}
          onUnarchive={actions.onUnarchive}
          onDelete={actions.onDelete}
          onCloseDrawer={onClose}
        />
      );
    default: {
      // Exhaustiveness check — the union forbids any other value at
      // compile time, so this is a safety belt.
      const _exhaust: never = activeTab;
      return _exhaust;
    }
  }
}

function DrawerLoading() {
  return (
    <div className="space-y-3">
      <div className="h-6 w-1/3 animate-pulse rounded bg-slate-200" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      <div className="mt-4 h-12 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}

function DrawerError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">خطا در بارگذاری تنظیمات بورد.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
      >
        تلاش مجدد
      </button>
    </div>
  );
}
