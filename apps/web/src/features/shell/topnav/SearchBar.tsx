"use client";

// apps/web/src/features/shell/topnav/SearchBar.tsx
//
// Placeholder search input. F4 ships only the visual + keyboard
// scaffold (Cmd/Ctrl+K opens nothing yet — the global hook in
// `useCommandK` registers a console.debug log so devs see the
// shortcut firing). The real search palette lands in F1.5 alongside
// workspace search, label search, and assignee search.
//
// dir="auto" on the input lets the placeholder text be right-aligned
// while user input direction follows whatever they type.

import { useEffect, useRef } from "react";
import { Search } from "lucide-react";

import { useCommandK } from "../hooks/useCommandK";

export function SearchBar() {
  const inputRef = useRef<HTMLInputElement>(null);

  // Wire Cmd/Ctrl+K. The hook calls our callback when the shortcut
  // fires; we focus the input as a visual proxy for "search opened".
  // F1.5 will replace this with `setOpen(true)` on a command palette.
  useCommandK(() => {
    inputRef.current?.focus();
  });

  // Intercept the form submit so a stray Enter on the placeholder
  // doesn't trigger a page reload. F1.5 will replace this with the
  // real palette open + query dispatch.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") e.preventDefault();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative w-full max-w-sm">
      <Search
        className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        placeholder="جستجو…  (Ctrl+K)"
        dir="auto"
        aria-label="جستجو"
        className="
          h-9 w-full rounded-md border border-slate-300 bg-white
          ps-8 pe-3 text-sm
          focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
        "
      />
    </div>
  );
}
