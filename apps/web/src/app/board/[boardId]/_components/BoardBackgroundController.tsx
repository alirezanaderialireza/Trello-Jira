"use client";

// apps/web/src/app/board/[boardId]/_components/BoardBackgroundController.tsx
//
// Sets the `--board-bg` CSS custom property on `document.body` to
// match the persisted board backgroundData on first paint. The
// BackgroundTab in the settings drawer writes to the same property
// for hover-preview; this controller is what re-establishes the
// persisted value after a navigation or a tab unmount.
//
// Why a Client Component wrapper rather than a server-injected
// <style> tag:
//   • Tightly scoped — the property is set on mount and removed on
//     unmount (e.g. when the user navigates away from /board/<id>),
//     so other pages aren't polluted.
//   • Plays well with Next 15 streaming / partial hydration —
//     no flash because the <main> element's inline style uses the
//     persisted CSS as the var() fallback, so SSR paint already
//     shows the right colour even before this controller hydrates.

import { useEffect } from "react";

import { BOARD_BG_CSS_VAR } from "../../../../features/board-settings/lib/applyBackground";

interface Props {
  /** CSS value matching the persisted backgroundData. Pass the same
   *  value as the var() fallback on the canvas <main> element so
   *  SSR + first hydration paint identically. */
  initialCss: string;
  children: React.ReactNode;
}

export function BoardBackgroundController({ initialCss, children }: Props) {
  useEffect(() => {
    document.body.style.setProperty(BOARD_BG_CSS_VAR, initialCss);
    return () => {
      document.body.style.removeProperty(BOARD_BG_CSS_VAR);
    };
  }, [initialCss]);

  return <>{children}</>;
}
