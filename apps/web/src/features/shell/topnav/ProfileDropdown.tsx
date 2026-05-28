"use client";

// apps/web/src/features/shell/topnav/ProfileDropdown.tsx
//
// Profile menu in the topnav. Shows the user's avatar fallback
// (Persian-grapheme initial), display name + email line on hover,
// and a menu of:
//
//   • Locale (fa / en)
//   • Timezone (Asia/Tehran by default; brief Persian description)
//   • Theme (light / dark / system) — UI-only in F4; the theme
//     application is a separate phase
//   • Logout
//
// All preference changes go through Server Actions wired in Commit 6.
// Until then the menu items toast "به‌زودی" so the UX is honest.
// Logout uses next-auth/react's signOut() which is already shipped
// and works today.

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { Globe, Clock, Sun, LogOut, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { getFirstGrapheme } from "../../../lib/persianGrapheme";

interface ProfileDropdownProps {
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  timezone: string;
}

const LOCALE_LABELS: Record<string, string> = {
  fa: "فارسی",
  en: "English",
};

export function ProfileDropdown({
  displayName,
  avatarUrl,
  locale,
  timezone,
}: ProfileDropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (
        t &&
        menuRef.current &&
        !menuRef.current.contains(t) &&
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

  function handlePreferencePlaceholder() {
    // Commit 6 wires the real Server Actions. Until then we surface
    // a toast so the user knows the click was registered and the
    // feature is in flight.
    toast.message("تغییر تنظیمات به‌زودی فعال می‌شود.");
    setOpen(false);
  }

  async function handleSignOut() {
    setOpen(false);
    await signOut({ callbackUrl: "/login" });
  }

  const initial = getFirstGrapheme(displayName);
  const localeDisplay = LOCALE_LABELS[locale] ?? locale;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="منوی پروفایل"
        className="
          flex h-9 items-center gap-1.5 rounded-full p-0.5 text-slate-700
          hover:bg-slate-100
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        "
      >
        {/* Avatar */}
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="
              flex h-8 w-8 items-center justify-center rounded-full
              bg-slate-200 text-sm font-semibold text-slate-700
            "
          >
            {initial}
          </span>
        )}
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="منوی پروفایل"
          className="
            absolute end-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-md
            border border-slate-200 bg-white shadow-lg
          "
        >
          {/* User identity header */}
          <div className="border-b border-slate-100 p-3">
            <div className="text-sm font-semibold text-slate-900" dir="auto">
              {displayName}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {localeDisplay} · {timezone}
            </div>
          </div>

          {/* Preference items */}
          <ul className="py-1">
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={handlePreferencePlaceholder}
                className="
                  flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700
                  hover:bg-slate-50
                  focus-visible:bg-slate-50 focus-visible:outline-none
                "
              >
                <Globe className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <span className="flex-1 text-start">زبان</span>
                <span className="text-xs text-slate-400">{localeDisplay}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={handlePreferencePlaceholder}
                className="
                  flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700
                  hover:bg-slate-50
                  focus-visible:bg-slate-50 focus-visible:outline-none
                "
              >
                <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <span className="flex-1 text-start">منطقه زمانی</span>
                <span className="text-xs text-slate-400">{timezone}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={handlePreferencePlaceholder}
                className="
                  flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700
                  hover:bg-slate-50
                  focus-visible:bg-slate-50 focus-visible:outline-none
                "
              >
                <Sun className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <span className="flex-1 text-start">تم</span>
                <span className="text-xs text-slate-400">روشن</span>
              </button>
            </li>
          </ul>

          {/* Sign out */}
          <div className="border-t border-slate-100">
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className="
                flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600
                hover:bg-red-50
                focus-visible:bg-red-50 focus-visible:outline-none
              "
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>خروج از حساب</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
