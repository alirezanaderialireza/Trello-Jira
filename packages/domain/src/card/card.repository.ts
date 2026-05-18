// packages/domain/src/card/card.repository.ts
//
// Fixes applied:
// ✅ #D-03: Interface contract diverged from ports/index.ts CardRepository.
//           ports/index.ts defines:
//             findById(id, options?) / getLastCardInList / save / create / delete
//           This file defined:
//             findById / getByListId / getLastCardInList / create / update / delete
//             + validateCardAccess / incrementRevision (not in port)
//           The port contract is what DrizzleCardRepository actually implements.
//           Fix: align this interface with ports/index.ts so it's usable as
//           the typed contract everywhere. Extra methods moved to an extension.
//
// ✅ #D-04: delete() signature here was:
//             delete(cardId, tenantId, options?)
//           ports/index.ts defines:
//             delete(tx, id: CardId): Promise<void>
//           DrizzleCardRepository implements the port version (now with OCC fix).
//           Fix: align to port contract.

import type { Card } from "./types";

// Re-export from ports to avoid contract fragmentation
export type { CardRepository } from "../ports";