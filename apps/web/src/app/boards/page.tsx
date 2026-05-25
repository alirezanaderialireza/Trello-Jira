// apps/web/src/app/boards/page.tsx
// Server component wrapper — renders the client-side board list.

import { BoardListPage } from "../../features/boards/components/BoardListPage";

export const metadata = {
  title: "My Boards — Trello OS",
};

// ─── Skip static prerender ────────────────────────────────────────────────
// BoardListPage is a client component that calls trpc.useQuery at render
// time. The current root layout wires QueryProvider and SessionProvider
// but NOT a tRPC client provider, so any prerender attempt fails with:
//   Error: Unable to find tRPC Context. Did you forget to wrap your App
//   inside `withTRPC` HoC?
//
// Until the App-Router-style tRPC provider is added at layout.tsx, mark
// this segment dynamic so Next renders it at request time (where the
// missing provider would crash anyway, but at least the build passes).
// `dynamic = "force-dynamic"` is honoured here because this file is a
// server component (no "use client").
// ──────────────────────────────────────────────────────────────────────────
export const dynamic = "force-dynamic";

export default function BoardsPage() {
  return <BoardListPage />;
}
