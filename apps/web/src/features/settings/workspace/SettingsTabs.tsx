"use client";

// apps/web/src/features/settings/workspace/SettingsTabs.tsx
//
// Client Component nav for the three workspace settings tabs.
// Lives in features/ (not in the layout) because it needs
// `usePathname()` to highlight the active tab — Server Components
// can't read the URL pathname directly.
//
// All three tabs render unconditionally for OWNER and ADMIN. The
// danger tab content varies inside the tab page itself: ADMIN sees
// "leave workspace" only, OWNER sees "transfer ownership + delete
// workspace + leave workspace". MEMBERs never reach this nav (the
// layout role gate redirects them away).

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  slug: string;
  /** Workspace role of the current user (OWNER or ADMIN at this point). */
  role: string;
}

interface TabDef {
  id: string;
  label: string;
  /** Path segment under /settings/. */
  segment: string;
}

const TABS: readonly TabDef[] = [
  { id: "general", label: "عمومی", segment: "general" },
  { id: "members", label: "اعضا", segment: "members" },
  { id: "danger", label: "ناحیهٔ خطر", segment: "danger" },
] as const;

export function SettingsTabs({ slug, role: _role }: Props) {
  const pathname = usePathname();

  return (
    <nav
      className="flex gap-1 overflow-x-auto border-b border-slate-200"
      aria-label="تب‌های تنظیمات"
    >
      {TABS.map((tab) => {
        const href = `/workspaces/${slug}/settings/${tab.segment}`;
        // Active match: pathname starts with the tab's full path.
        // Index segment redirects to /general, so this still works
        // if the user lands on /settings (briefly).
        const isActive =
          pathname === href || pathname.startsWith(`${href}/`);
        const activeStyles = isActive
          ? "border-blue-600 text-blue-700"
          : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700";
        return (
          <Link
            key={tab.id}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`-mb-px inline-flex items-center border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${activeStyles}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
