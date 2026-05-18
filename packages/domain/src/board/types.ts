// packages/domain/src/board/types.ts

// ✅ fix: import از canonical location — نه از board.repository
// board.repository.ts نباید source of truth برای branded types باشد.
// shared/ids.ts تنها مکان تعریف این types در کل monorepo است.
import type { BoardId, TenantId, Revision } from "../shared/ids";

export interface Board {
  id: BoardId;
  tenantId: TenantId;
  title: string;
  revision: Revision;
  aclVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archivedAt: Date | null;
}