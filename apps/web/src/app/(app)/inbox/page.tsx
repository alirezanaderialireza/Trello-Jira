// apps/web/src/app/(app)/inbox/page.tsx
//
// Phase 1.2 (F1.2.9) — full notifications inbox. The heavy lifting lives in
// the client feature component (it uses tRPC hooks); this route just mounts
// it inside the (app) shell.

import { InboxPage } from "@/features/notifications/InboxPage";

export default function Page() {
  return <InboxPage />;
}
