// apps/web/src/app/layout.tsx

import "./globals.css";
import { Toaster } from "sonner";
import { TRPCProvider } from "../providers/TRPCProvider";
import { SessionProvider } from "next-auth/react";
import { RootErrorBoundary } from "../components/error/ErrorBoundary";
import { GlobalErrorListener } from "../components/error/GlobalErrorListener";
import { DevtoolsClient } from "./_components/DevtoolsClient";

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
  //
  // <DevtoolsClient> is a client component wrapper that hosts the
  // `next/dynamic({ ssr: false })` import for the dev overlay. Next.js 15+
  // disallows ssr:false dynamic imports from a Server Component (and
  // `app/layout.tsx` is one by default), so the import lives in a
  // client component. In production the wrapper renders null and the
  // lazy chunk is tree-shaken away by the static NODE_ENV check.
  //
  // <TRPCProvider> replaces the legacy <QueryProvider> (Phase 1.1.5):
  // the old provider only wired React Query and left every
  // `trpc.X.Y.useQuery()` call without a tRPC context, crashing every
  // (app) route. TRPCProvider wraps both `<trpc.Provider>` and
  // `<QueryClientProvider>` together with the same React Query
  // defaults the legacy file used.
  return (
    <html lang="fa" dir="rtl">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <RootErrorBoundary>
          <GlobalErrorListener />
          <SessionProvider>
            <TRPCProvider>
              {children}
              <DevtoolsClient />
            </TRPCProvider>
          </SessionProvider>
        </RootErrorBoundary>

        <Toaster position="bottom-right" richColors theme="light" />
      </body>
    </html>
  );
}
