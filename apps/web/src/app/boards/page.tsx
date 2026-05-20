// apps/web/src/app/boards/page.tsx
// Server component wrapper — renders the client-side board list.

import { BoardListPage } from "../../features/boards/components/BoardListPage";

export const metadata = {
  title: "My Boards — Trello OS",
};

export default function BoardsPage() {
  return <BoardListPage />;
}
