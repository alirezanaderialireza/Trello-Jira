import { relations } from "drizzle-orm";

import { boards } from "./boards";
import { lists } from "./lists";
import { cards } from "./cards";
import { boardMembers } from "./boardMembers";
import { sessions, revokedTokens } from "./sessions";

//
// ============================================================================
// 🔷 Boards Relations
// ============================================================================
// Board → Lists, Members, Cards (denormalized)
// ============================================================================

export const boardsRelations = relations(boards, ({ many }) => ({
  lists: many(lists),
  members: many(boardMembers),
  cards: many(cards), // denormalized for fast sync & board-wide queries
}));

//
// ============================================================================
// 🔷 Lists Relations
// ============================================================================
// List → Board, Cards
// ============================================================================

export const listsRelations = relations(lists, ({ one, many }) => ({
  board: one(boards, {
    fields: [lists.boardId],
    references: [boards.id],
  }),
  cards: many(cards),
}));

//
// ============================================================================
// 🔷 Cards Relations
// ============================================================================
// Card → List, Board (denormalized)
// ============================================================================

export const cardsRelations = relations(cards, ({ one }) => ({
  list: one(lists, {
    fields: [cards.listId],
    references: [lists.id],
  }),
  board: one(boards, {
    fields: [cards.boardId],
    references: [boards.id],
  }),
}));

//
// ============================================================================
// 🔷 Board Members Relations
// ============================================================================
// BoardMember → Board
// ============================================================================

export const boardMembersRelations = relations(boardMembers, ({ one }) => ({
  board: one(boards, {
    fields: [boardMembers.boardId],
    references: [boards.id],
  }),
}));