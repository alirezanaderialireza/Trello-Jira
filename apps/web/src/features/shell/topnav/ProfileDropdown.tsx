"use client";

// apps/web/src/features/shell/topnav/ProfileDropdown.tsx
//
// Profile menu in the topnav. Shows the user's avatar fallback
// (Persian-grapheme initial), display name + locale·timezone, and a
// menu of:
//
//   • Locale (fa ⇄ en) — wired via the injected
//                        `onUpdatePreferences` Server Action prop
//                        (see Lesson F4: features cannot import
//                        from app/*; the action is hoisted into
//                        AppShell and passed as a prop).
//                        One click toggles to the other locale.
//   • Timezone — placeholder; full picker lands in a future phase.
//   • Theme — placeholder; theme application + persistence is its
//             own dedicated phase.
//   • Logout — next-auth/react signOut, callback to /login.
//
// The locale toggle uses the optimistic UX pattern: click → server
// action → revalidate the layout → re-render with new locale text.
// We don't change the cookie or local storage; the canonical state
// is `users.locale` in the DB and we trust the round-trip to settle
// quickly.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Globe, Clock, Sun, LogOut, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { getFirstGrapheme } from "../../../lib/persianGrapheme";

/**
 * Shape of the Server Action result for updating user preferences.
 * Defined structurally so this feature never imports from app/*.
 * The action under app/(app)/_actions/updatePreferences.ts conforms
 * to a wider input type (locale | timezone | preferences); we only
 * model the slice F4 wires (locale toggle). TypeScript variance
 * (parameters contravariant) makes the wider action assignable to
 * this narrower prop type at the parent (app) layer.
 */
export type UpdatePreferencesAction = (input: {
  locale?: "fa" | "en";
}) => Promise<{ ok: boolean; error?: string }>;

interface ProfileDropdownProps {
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  timezone: string;
  onUpdatePreferences: UpdatePreferencesAction;
}

const LOCALE_LABELS: Record<string, string> = {
  fa: "فارسی",
  en: "English",
};

/** Toggle target — fa ↔ en. F4 ships only these two locales. */
function nextLocale(current: string): "fa" | "en" {
  return current === "fa" ? "en" : "fa";
}

export function ProfileDropdown({
  displayName,
  avatarUrl,
  locale,
  timezone,
  onUpdatePreferences,
}: ProfileDropdownProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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

  async function handleLocaleToggle() {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    try {
      const target = nextLocale(locale);
      const result = await onUpdatePreferences({ locale: target });
      if (!result.ok) {
        toast.error(result.error ?? "خطا در تغییر زبان.");
        return;
      }
      toast.success("زبان به‌روز شد.");
      // The action revalidated the layout cache; refresh re-fetches
      // sidebar.bootstrap with the new currentUser.locale.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function handleStillPlaceholder() {
    toast.message("تغییر این تنظیم به‌زودی فعال می‌شود.");
    setOpen(false);
  }

  async function handleSignOut() {
    setOpen(false);
    await signOut({ callbackUrl: "/login" });
  }

  const initial = getFirstGrapheme(displayName);
  const localeDisplay = LOCALE_LABELS[locale] ?? locale;
  const nextLocaleLabel = LOCALE_LABELS[nextLocale(locale)] ?? nextLocale(locale);

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

          <ul className="py-1">
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={handleLocaleToggle}
                disabled={busy}
                className="
                  flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700
                  hover:bg-slate-50
                  disabled:cursor-not-allowed disabled:opacity-50
                  focus-visible:bg-slate-50 focus-visible:outline-none
                "
              >
                <Globe className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <span className="flex-1 text-start">
                  {busy ? "در حال تغییر زبان…" : `تغییر زبان به ${nextLocaleLabel}`}
                </span>
                <span className="text-xs text-slate-400">{localeDisplay}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={handleStillPlaceholder}
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
                onClick={handleStillPlaceholder}
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
