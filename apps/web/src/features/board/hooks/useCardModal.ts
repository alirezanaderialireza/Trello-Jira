"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition, useEffect } from "react";

// ============================================================================
// 🧠 Module-Level Singleton State (The Fix for Multi-Instance Bug)
// ============================================================================
const modalNavState = {
  previousUrl: null as string | null,
  openedViaApp: false,
  navigationId: 0,
  // بافر همگام برای حل مشکل Batching
  syncSearchParams: new URLSearchParams(), 
};

export function useCardModal() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // همگام‌سازی اولیه بافر با URL واقعی
  useEffect(() => {
    modalNavState.syncSearchParams = new URLSearchParams(searchParams.toString());
  }, [searchParams]);

  const rawCardId = searchParams.get("card");
  const isValidId = (id: string | null) => typeof id === "string" && id.length > 0 && id.length < 200;
  const cardId = isValidId(rawCardId) ? rawCardId : null;

  // --------------------------------------------------------------------------
  // 🌟 موتور اصلی آپدیت URL (Sync + Transition + History API fallback)
  // --------------------------------------------------------------------------
  const updateUrl = useCallback(
    (
      updater: (params: URLSearchParams) => void,
      options: { action?: "push" | "replace" | "back"; shallow?: boolean } = {}
    ) => {
      const { action = "replace", shallow = false } = options;
      const navId = ++modalNavState.navigationId;

      // 🌟 (Fix 2) همیشه روی بافر همگام کار می‌کنیم، نه روی استیت قدیمی
      updater(modalNavState.syncSearchParams);
      const query = modalNavState.syncSearchParams.toString();
      const finalPath = query ? `${pathname}?${query}` : pathname;

      // 🌟 (Fix 3) برای آپدیت‌های بسیار سریع (مثل عوض کردن تب داخل مودال)
      // می‌توانیم مستقیماً از History API مرورگر استفاده کنیم تا Next.js درگیر نشود
      if (shallow && action !== "back") {
        if (action === "push") window.history.pushState(null, "", finalPath);
        else window.history.replaceState(null, "", finalPath);
        return;
      }

      startTransition(() => {
        if (navId !== modalNavState.navigationId) return;

        if (action === "back") {
          // 🌟 (Fix 1) حالا این مقادیر از هر کامپوننتی درست خوانده می‌شوند
          if (modalNavState.openedViaApp && modalNavState.previousUrl) {
            router.replace(modalNavState.previousUrl, { scroll: false });
          } else {
            router.replace(pathname, { scroll: false }); // Fallback امن
          }
        } else if (action === "push") {
          router.push(finalPath, { scroll: false });
        } else {
          router.replace(finalPath, { scroll: false });
        }
      });
    },
    [pathname, router]
  );

  // --------------------------------------------------------------------------
  // باز کردن مودال
  // --------------------------------------------------------------------------
  const open = useCallback(
    (id: string) => {
      if (!isValidId(id)) return;

      // ذخیره وضعیت قبل از باز شدن در Singleton
      modalNavState.previousUrl = `${pathname}?${searchParams.toString()}`;
      modalNavState.openedViaApp = true;

      updateUrl(
        (params) => params.set("card", id),
        { action: cardId ? "replace" : "push" }
      );
    },
    [updateUrl, cardId, pathname, searchParams]
  );

  // --------------------------------------------------------------------------
  // بستن مودال
  // --------------------------------------------------------------------------
  const close = useCallback(() => {
    updateUrl(
      (params) => params.delete("card"),
      { action: "back" }
    );
    modalNavState.openedViaApp = false;
  }, [updateUrl]);

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  const setParam = useCallback(
    (key: string, value: string, shallow = false) => {
      updateUrl((p) => p.set(key, value), { action: "replace", shallow });
    },
    [updateUrl]
  );

  const removeParam = useCallback(
    (key: string, shallow = false) => {
      updateUrl((p) => p.delete(key), { action: "replace", shallow });
    },
    [updateUrl]
  );

  return {
    cardId,
    open,
    close,
    setParam,
    removeParam,
    isPending,
  };
}