"use client";

// apps/web/src/features/board/engine/useViewportShiftGuard.ts
//
// Phase 1.3 (F1.3.4) — mobile viewport-shift guard (D7/T4).
//
// When a text field is focused on a touch device, the virtual keyboard
// shrinks the visual viewport. Without help, the focused input can end up
// hidden behind the keyboard and absolutely/fixed-positioned DnD affordances
// can jump. This guard, scoped to coarse-pointer (touch) devices only so the
// desktop experience is unchanged:
//
//   • on focus of an editable element → scrolls it into view (centred) on the
//     next frame, after the keyboard animation has begun, and marks the body
//     with `data-vp-shift` so styling can pin/teardown transforms if needed.
//   • on blur → clears the marker on the next frame.
//
// Self-contained: it only adds/removes its own listeners and a body attribute,
// all torn down on unmount (no leaks).

import { useEffect } from "react";

function isEditable(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function useViewportShiftGuard(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Touch devices only — desktop keyboards don't resize the viewport.
    const isCoarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    if (!isCoarse) return;

    let raf = 0;

    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target)) return;
      const el = e.target as HTMLElement;
      document.body.setAttribute("data-vp-shift", "1");
      cancelAnimationFrame(raf);
      // Wait a frame so the keyboard has started resizing the viewport before
      // we recenter the field.
      raf = requestAnimationFrame(() => {
        try {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch {
          /* older browsers: scrollIntoView options unsupported — ignore */
        }
      });
    };

    const onFocusOut = (e: FocusEvent) => {
      if (!isEditable(e.target)) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        document.body.removeAttribute("data-vp-shift");
      });
    };

    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      document.body.removeAttribute("data-vp-shift");
    };
  }, []);
}
