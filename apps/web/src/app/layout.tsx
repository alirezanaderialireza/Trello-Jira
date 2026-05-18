// apps/web/src/app/layout.tsx

import "./globals.css";
import { Toaster } from "sonner";
import { QueryProvider } from "../providers/QueryProvider";

// ✅ fix: dynamic import برای devtools
// با static import، BoardDevtoolsOverlay همیشه در bundle بود حتی در production.
// با dynamic import + ssr:false:
// 1. در production build اصلاً bundled نمی‌شود (tree-shaken)
// 2. فقط در client-side load می‌شود (چون "use client" است)
// 3. بدون این، Next.js ممکن است در SSR crash کند چون devtools به window/store وابسته است
import dynamic from "next/dynamic";

const BoardDevtoolsOverlay =
  process.env.NODE_ENV === "development"
    ? dynamic(
        () =>
          import("../features/board/devtools/BoardDevtoolsOverlay").then(
            (mod) => mod.BoardDevtoolsOverlay,
          ),
        { ssr: false }, // devtools به useBoardStore/Zustand وابسته است — SSR-safe نیست
      )
    : null;

export const metadata = {
  title: "Trello OS",
  description: "Advanced Trello Clone with DDD Architecture",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <QueryProvider>
          {children}

          {/* Devtools فقط در development — در production از bundle حذف می‌شود */}
          {BoardDevtoolsOverlay && <BoardDevtoolsOverlay />}
        </QueryProvider>

        <Toaster position="bottom-right" richColors theme="light" />
      </body>
    </html>
  );
}