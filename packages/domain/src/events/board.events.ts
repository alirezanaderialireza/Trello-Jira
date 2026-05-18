// packages/domain/src/events/board.events.ts

import type { DomainEvent } from "./base";

// ============================================================================
// 1. Board Created
// ============================================================================
export interface BoardCreatedPayload {
  readonly title: string;
  readonly workspaceId: string;
  readonly defaultBackground: string;
}

export interface BoardCreatedEvent extends DomainEvent<"board.created", BoardCreatedPayload> {}

// ============================================================================
// 2. Board Renamed (Updated)
// ============================================================================
export interface BoardRenamedPayload {
  readonly oldTitle: string;
  readonly newTitle: string;
}

export interface BoardRenamedEvent extends DomainEvent<"board.renamed", BoardRenamedPayload> {}

// ============================================================================
// 3. Board Archived (Soft Delete / Freeze)
// ============================================================================
export interface BoardArchivedPayload {
  readonly reason?: string;
  readonly archivedAt: string; // UTC ISO String
}

export interface BoardArchivedEvent extends DomainEvent<"board.archived", BoardArchivedPayload> {}

// ============================================================================
// 4. Board Unarchived (Restored)
// ============================================================================
export interface BoardUnarchivedPayload {
  readonly unarchivedAt: string;
}

export interface BoardUnarchivedEvent extends DomainEvent<"board.unarchived", BoardUnarchivedPayload> {}

// ============================================================================
// 5. Board Visibility Changed
// ============================================================================
export type BoardVisibility = "private" | "workspace" | "public";

export interface BoardVisibilityChangedPayload {
  readonly oldVisibility: BoardVisibility;
  readonly newVisibility: BoardVisibility;
}

export interface BoardVisibilityChangedEvent extends DomainEvent<"board.visibility_changed", BoardVisibilityChangedPayload> {}

// ============================================================================
// 🚀 Aggregate Type Export
// ============================================================================
/**
 * این Union Type در Reducerها و Workerها استفاده می‌شود تا تایپ‌اسکریپت 
 * به صورت خودکار تمام حالت‌های دیسپچر را چک کند.
 */
export type BoardEvent =
  | BoardCreatedEvent
  | BoardRenamedEvent
  | BoardArchivedEvent
  | BoardUnarchivedEvent
  | BoardVisibilityChangedEvent;