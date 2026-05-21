// apps/web/src/app/layout.tsx

import "./globals.css";
import { Toaster } from "sonner";
import { QueryProvider } from "../providers/QueryProvider";
import { SessionProvider } from "next-auth/react";
import { RootErrorBoundary } from "../components/error/ErrorBoundary";
import { GlobalErrorListener } from "../components/error/GlobalErrorListener";

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
  // The hierarchy below puts the error-handling primitives at the
  // outermost layer so they catch as much as possible:
  //   • <RootErrorBoundary> — last-resort React boundary (render-phase
  //     errors that escaped per-route boundaries / app/error.tsx).
  //   • <GlobalErrorListener> — subscribes to window.error and
  //     window.unhandledrejection for the async leakage the React
  //     boundary cannot catch.
  // Both must live INSIDE <body> (they touch the DOM / browser APIs)
  // and BEFORE the providers so even a crash in SessionProvider /
  // QueryProvider is captured.
  return (
    <html lang="fa" dir="rtl">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <RootErrorBoundary>
          <GlobalErrorListener />
          <SessionProvider>
            <QueryProvider>
              {children}

              {/* Devtools فقط در development */}
              {BoardDevtoolsOverlay && <BoardDevtoolsOverlay />}
            </QueryProvider>
          </SessionProvider>
        </RootErrorBoundary>

        <Toaster position="bottom-right" richColors theme="light" />
      </body>
    </html>
  );
}