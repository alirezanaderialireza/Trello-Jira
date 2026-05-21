// apps/web/src/app/layout.tsx

import "./globals.css";
import { Toaster } from "sonner";
import { QueryProvider } from "../providers/QueryProvider";
import { SessionProvider } from "next-auth/react";

// ✅ fix: dynamic import برای devtools
import dynamic from "next/dynamic";

const BoardDevtoolsOverlay =
  process.env.NODE_ENV === "development"
    ? dynamic(
        () =>
          import("../features/board/devtools/BoardDevtoolsOverlay").then(
            (mod) => mod.BoardDevtoolsOverlay,
          ),
        { ssr: false },
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
    <html lang="fa" dir="rtl">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <SessionProvider>
          <QueryProvider>
            {children}

            {/* Devtools فقط در development */}
            {BoardDevtoolsOverlay && <BoardDevtoolsOverlay />}
          </QueryProvider>
        </SessionProvider>

        <Toaster position="bottom-right" richColors theme="light" />
      </body>
    </html>
  );
}