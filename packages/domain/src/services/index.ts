// packages/domain/src/services/index.ts
//
// Fixes applied:
// ✅ #D-07: moveCardDomainService doesn't bump card.revision after a move.
//           The domain contract requires revision to be incremented on every
//           mutation so OCC guards and WS reconciliation work correctly.
//           Board.service.ts calls cardRepo.save() with expectedRevision =
//           card.revision, and expects the returned entity to have revision+1.
//           Without the bump, save() stores the same revision, and the next
//           OCC check will always pass on a stale entity.
//
// ✅ #D-08: catch(error: any) — `error.message` access is unsafe. The
//           PositionCollisionError class name or a typed check is safer.

import type { Card } from "../card/types";
import type { List } from "../list/types";
import type { DomainErrorReason } from "../errors/error-codes";
import { getNewPosition } from "../ordering";

export interface MoveCardDomainParams {
  card: Card;
  targetList: List;
  prevCard: Card | null;
  nextCard: Card | null;
  mode: "APPEND" | "PREPEND" | "INSERT_BETWEEN" | "REORDER_SAME_LIST";
}

export type DomainServiceResult =
  | { success: false; reason: DomainErrorReason }
  | { success: true; card: Card };

export function moveCardDomainService(
  params: MoveCardDomainParams,
): DomainServiceResult {
  const { card, targetList, prevCard, nextCard } = params;

  try {
    const prevPosition = prevCard?.position;
    const nextPosition = nextCard?.position;

    const newPosition = getNewPosition(prevPosition, nextPosition);

    const updatedCard: Card = {
      ...card,
      listId:   targetList.id,
      position: newPosition,
      // ✅ #D-07: bump revision so OCC guards and WS reconciliation stay correct
      revision: card.revision + 1,
      updatedAt: new Date(),
    };

    return { success: true, card: updatedCard };
  } catch (error: unknown) {
    // ✅ #D-08: typed error check instead of (error as any).message
    const isCollision =
      error instanceof Error &&
      (error.message === "POSITION_COLLISION_RESOLVING" ||
        error.constructor.name === "PositionCollisionError");

    if (isCollision) {
      return { success: false, reason: "CORRUPTED_CHAIN" };
    }

    return { success: false, reason: "INVALID_REQUEST_PAYLOAD" };
  }
}