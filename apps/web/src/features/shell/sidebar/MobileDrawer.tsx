"use client";

// apps/web/src/features/shell/sidebar/MobileDrawer.tsx
//
// Custom fixed-overlay drawer used on viewports < md (768px) where
// the desktop sidebar collapses to icon-only or hides.
//
// We intentionally avoid Radix UI / @radix-ui/react-dialog (per F4
// D4): the dependency isn't in the package.json and adding it would
// require a sandbox-blocked `pnpm install`. The overlay below covers
// the four hard cases a Dialog primitive handles:
//
//   • Backdrop click closes
//   • Escape closes
//   • Body scroll lock while open
//   • aria-modal="true" + role="dialog" + aria-labelledby
//
// Focus trapping is left to the OS — the drawer mounts only inside
// the (app) tree, so outside-tab focus targets fall back to the
// browser's default cycle (no truly focusable elements outside while
// open). A formal trap is not worth the complexity for F4.

import { useEffect } from "react";
import { X } from "lucide-react";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Accessibility heading id; the drawer's `aria-labelledby` points
   * here so screen readers announce the section name. Caller is
   * responsible for rendering an element with this id inside.
   */
  titleId?: string;
}

export function MobileDrawer({
  open,
  onClose,
  children,
  titleId = "mobile-drawer-title",
}: MobileDrawerProps) {
  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while open. Without this, a tap on the backdrop
  // can cause the underlying page to scroll, which feels broken.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-40 md:hidden"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/*
        Drawer pane. Anchored to the inline-end side (right in RTL,
        left in LTR). Width capped at 18rem so on narrow phones (iPhone
        SE 375px) the user can still see a sliver of the page underneath
        as a tap-to-close affordance.
      */}
      <aside
        className="
          absolute inset-y-0 end-0 z-10 flex w-72 max-w-[80vw] flex-col
          border-s border-slate-200 bg-white shadow-xl
        "
      >
        <header className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
          <span id={titleId} className="text-sm font-semibold text-slate-900">
            منو
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="
              rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
            "
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3">{children}</div>
      </aside>
    </div>
  );
}
