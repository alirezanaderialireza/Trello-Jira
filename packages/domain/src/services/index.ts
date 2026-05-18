// packages/domain/src/services/index.ts
 
import type { Card } from "../card/types";
import type { List } from "../list/types";
import type { DomainErrorReason } from "../errors/error-codes"; // ✅ مسیر صحیح
import { getNewPosition } from "../ordering";
 
// ============================================================================
// 🧠 ورودی Domain Service برای جابجایی کارت
// ============================================================================
export interface MoveCardDomainParams {
  card: Card;
  targetList: List;
  prevCard: Card | null;
  nextCard: Card | null;
  mode: "APPEND" | "PREPEND" | "INSERT_BETWEEN" | "REORDER_SAME_LIST";
}
 
// ============================================================================
// 🛡️ خروجی Domain Service
// ============================================================================
export type DomainServiceResult =
  | { success: false; reason: DomainErrorReason }
  | { success: true; card: Card };
 
// ============================================================================
// 🚀 تابع Pure Domain Logic برای جابجایی کارت
// ============================================================================
 
export function moveCardDomainService(
  params: MoveCardDomainParams
): DomainServiceResult {
  const { card, targetList, prevCard, nextCard } = params;
 
  try {
    const prevPosition = prevCard ? prevCard.position : undefined;
    const nextPosition = nextCard ? nextCard.position : undefined;
 
    const newPosition = getNewPosition(prevPosition, nextPosition);
 
    const updatedCard: Card = {
      ...card,
      listId: targetList.id,
      position: newPosition,
    };
 
    return { success: true, card: updatedCard };
 
  } catch (error: any) {
    if (error.message === "POSITION_COLLISION_RESOLVING") {
      return { success: false, reason: "CORRUPTED_CHAIN" };
    }
 
    return { success: false, reason: "INVALID_REQUEST_PAYLOAD" };
  }
}