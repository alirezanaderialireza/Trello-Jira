// apps/web/src/app/layout.tsx

import "./globals.css";
import { Toaster } from "sonner";
import { QueryProvider } from "../providers/QueryProvider";
import { DevtoolsLoader } from "./_components/DevtoolsLoader";

// Note: the Board devtools overlay is dynamically imported with `ssr: false`
// inside a Client Component (`DevtoolsLoader`) — Next.js 16 / Turbopack no
// longer allow `next/dynamic({ ssr: false })` directly in Server Components.

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

          {/* Devtools only in development — tree-shaken in production. */}
          <DevtoolsLoader />
        </QueryProvider>

        <Toaster position="bottom-right" richColors theme="light" />
      </body>
    </html>
  );
}