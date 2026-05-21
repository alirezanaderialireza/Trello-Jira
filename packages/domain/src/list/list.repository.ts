// packages/domain/src/list/list.repository.ts
//
// Fixes applied:
// ✅ #D-05: Interface contract diverged from ports/index.ts ListRepository.
//           ports/index.ts defines the canonical ListRepository<TTx> that
//           DrizzleListRepository actually implements.
//           This file defined a different, incompatible interface with methods
//           like getByBoardId({ boardId, tenantId, tx }) while the port defines
//           getByBoardId(boardId: BoardId): Promise<List[]> — different signatures.
//           Fix: align to port contract and re-export from ports/index.ts.
//
// ✅ #D-06: getLastListInBoard signature here:
//             getLastListInBoard({ boardId, tenantId, tx }): Promise<List | null>
//           ports/index.ts signature:
//             getLastListInBoard(tx, boardId): Promise<List | null>
//           DrizzleListRepository implements the port version.
//           Fix: align to port contract.

import type { List } from "./types";

// Re-export from ports to avoid contract fragmentation
export type { ListRepository } from "../ports";