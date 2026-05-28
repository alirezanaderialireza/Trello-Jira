"use client";

// apps/web/src/features/shell/sidebar/WorkspaceNode.tsx
//
// A single workspace row in the Sidebar's Workspaces section.
//
// Renders the workspace name, role badge ("مالک" / "مدیر" / …) and
// links to the workspace detail page. The `expanded` state from the
// UI preferences store is used to highlight the row when its
// workspace is currently focused; the chevron flips via
// `rtl:rotate-180` so it points "into" the workspace in both LTR
// and RTL.
//
// F4 keeps the row a flat link (no nested boards). Boards under a
// workspace appear in the Starred and Recent sections; workspace
// detail pages render the full boards list. A future phase can
// add lazy-loaded board lists under each node here.

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getWorkspaceRoleLabel } from "../lib/roleLabels";

export interface WorkspaceNodeData {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface WorkspaceNodeProps {
  workspace: WorkspaceNodeData;
  isActive: boolean;
}

export function WorkspaceNode({ workspace, isActive }: WorkspaceNodeProps) {
  return (
    <li>
      <Link
        href={`/workspaces/${workspace.slug}`}
        title={`${workspace.name} — ${getWorkspaceRoleLabel(workspace.role)}`}
        className={`
          group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm
          transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
          ${
            isActive
              ? "bg-blue-100 text-blue-900"
              : "text-slate-700 hover:bg-slate-100"
          }
        `}
      >
        <span className="truncate" dir="auto">
          {workspace.name}
        </span>

        <span className="flex flex-shrink-0 items-center gap-1.5">
          <span
            className={`
              rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide
              ${
                isActive
                  ? "bg-blue-200 text-blue-800"
                  : "bg-slate-200 text-slate-600 group-hover:bg-slate-300"
              }
            `}
          >
            {getWorkspaceRoleLabel(workspace.role)}
          </span>
          {/*
            ChevronLeft is the "navigate forward" affordance in RTL. In an
            LTR context the same icon would mean "go back" — but we are
            shipping LTR-disabled at the <html dir="rtl"> layer, so the
            visual semantics align. If LTR support is added later, swap to
            ChevronRight inside an `[dir=ltr]:` selector.
          */}
          <ChevronLeft
            className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600"
            aria-hidden="true"
          />
        </span>
      </Link>
    </li>
  );
}
