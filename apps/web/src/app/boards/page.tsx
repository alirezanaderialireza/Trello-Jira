// apps/web/src/app/boards/page.tsx
// Server component wrapper — renders the client-side board list.

// The board list calls tRPC client hooks (`createTRPCNext`) that require a
// runtime context provider. Skip static prerendering so Next.js doesn't try
// to render the client tree at build time.
export const dynamic = "force-dynamic";

import { BoardListPage } from "../../features/boards/components/BoardListPage";

export const metadata = {
  title: "My Boards — Trello OS",
};

export default function BoardsPage() {
  return <BoardListPage />;
}
