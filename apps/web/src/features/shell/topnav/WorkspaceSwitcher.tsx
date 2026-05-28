"use client";

// apps/web/src/features/shell/topnav/WorkspaceSwitcher.tsx
//
// Combobox in the topnav. Shows the currently-active workspace
// (derived from the URL — /workspaces/[slug]) and on click opens a
// searchable popover listing every workspace the user belongs to.
// Selecting a workspace navigates to `/workspaces/[slug]`.
//
// Empty-state per F4 D5: when the user has no workspaces, the
// trigger button reads "ایجاد فضای کاری" and on click opens the
// CreateWorkspaceButton dialog (re-imported here for symmetry).
// F4 keeps the CTA inert in this commit — Commit 6 wires the
// real Server Action.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown, Plus, Search } from "lucide-react";

import type { AppRouter } from "@repo/api";
import type { inferRouterOutputs } from "@trpc/server";

import { getWorkspaceRoleLabel } from "../lib/roleLabels";

type SidebarBootstrap = inferRouterOutputs<AppRouter>["v1"]["public"]["sidebar"]["bootstrap"];
type Workspace = SidebarBootstrap["workspaces"][number];

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
}

export function WorkspaceSwitcher({ workspaces }: WorkspaceSwitcherProps) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Resolve the currently-active workspace from the URL.
  // /workspaces/{slug} or /workspaces/{slug}/anything → match by slug.
  const activeWorkspace = useMemo(() => {
    const m = pathname.match(/^\/workspaces\/([^/]+)/);
    if (!m) return null;
    return workspaces.find((w) => w.slug === m[1]) ?? null;
  }, [pathname, workspaces]);

  // Close on Escape and on outside click.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (
        t &&
        popoverRef.current &&
        !popoverRef.current.contains(t) &&
        !triggerRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // Reset filter when popover closes so re-opening starts fresh.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter(
      (w) =>
        w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q),
    );
  }, [query, workspaces]);

  // Empty state: no workspaces. Render a button that opens a "create
  // workspace" affordance. The CreateWorkspaceButton component lives
  // in the sidebar and is the canonical creation flow; here we link
  // to the workspaces page where the user can create one.
  if (workspaces.length === 0) {
    return (
      <Link
        href="/workspaces"
        className="
          flex items-center gap-2 rounded-md border border-slate-300 bg-white
          px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        "
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span>ایجاد فضای کاری</span>
      </Link>
    );
  }

  const triggerLabel = activeWorkspace
    ? activeWorkspace.name
    : "انتخاب فضای کاری";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="انتخاب فضای کاری"
        className="
          flex h-9 items-center gap-1.5 rounded-md border border-slate-300
          bg-white px-3 text-sm text-slate-700 hover:bg-slate-50
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        "
      >
        <span className="max-w-[160px] truncate" dir="auto">
          {triggerLabel}
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="listbox"
          aria-label="فضاهای کاری"
          className="
            absolute end-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-md
            border border-slate-200 bg-white shadow-lg
          "
        >
          {/* Search input */}
          <div className="relative border-b border-slate-100 p-2">
            <Search
              className="absolute start-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو در فضاهای کاری…"
              dir="auto"
              aria-label="جستجو در فضاهای کاری"
              className="
                h-8 w-full rounded border border-slate-200 bg-slate-50
                ps-7 pe-2 text-sm
                focus:border-blue-500 focus:bg-white focus:outline-none
              "
            />
          </div>

          {/* Workspace list */}
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-400">موردی یافت نشد.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {filtered.map((w) => {
                const isActive = activeWorkspace?.id === w.id;
                return (
                  <li key={w.id}>
                    <Link
                      href={`/workspaces/${w.slug}`}
                      onClick={() => setOpen(false)}
                      className={`
                        flex items-center justify-between gap-2 px-3 py-2 text-sm
                        ${
                          isActive
                            ? "bg-blue-50 text-blue-900"
                            : "text-slate-700 hover:bg-slate-50"
                        }
                      `}
                      role="option"
                      aria-selected={isActive}
                    >
                      <span className="min-w-0 truncate" dir="auto">
                        {w.name}
                      </span>
                      <span className="flex flex-shrink-0 items-center gap-1.5">
                        <span
                          className={`
                            rounded-full px-1.5 py-0.5 text-[10px] uppercase
                            ${
                              isActive
                                ? "bg-blue-200 text-blue-800"
                                : "bg-slate-100 text-slate-500"
                            }
                          `}
                        >
                          {getWorkspaceRoleLabel(w.role)}
                        </span>
                        {isActive && (
                          <Check
                            className="h-3.5 w-3.5 text-blue-600"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Footer CTA */}
          <div className="border-t border-slate-100">
            <Link
              href="/workspaces"
              onClick={() => setOpen(false)}
              className="
                flex items-center gap-2 px-3 py-2 text-sm text-slate-700
                hover:bg-slate-50
              "
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>ایجاد فضای کاری جدید</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
