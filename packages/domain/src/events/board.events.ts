// packages/domain/src/events/board.events.ts
import type { DomainEvent } from "./base";

export interface BoardCreatedPayload {
  readonly boardId: string;
  readonly title: string;
  readonly tenantId: string;
}
export interface BoardCreatedEvent extends DomainEvent<"board.created", BoardCreatedPayload> {}

export interface BoardRenamedPayload {
  readonly boardId: string;
  readonly title: string;
}
export interface BoardRenamedEvent extends DomainEvent<"board.renamed", BoardRenamedPayload> {}

export interface BoardArchivedPayload {
  readonly boardId: string;
}
export interface BoardArchivedEvent extends DomainEvent<"board.archived", BoardArchivedPayload> {}

export interface BoardUnarchivedPayload {
  readonly boardId: string;
}
export interface BoardUnarchivedEvent extends DomainEvent<"board.unarchived", BoardUnarchivedPayload> {}

export interface BoardVisibilityChangedPayload {
  readonly boardId: string;
  readonly visibility: "PUBLIC" | "PRIVATE" | "TEAM";
}
export interface BoardVisibilityChangedEvent
  extends DomainEvent<"board.visibility_changed", BoardVisibilityChangedPayload> {}

export type BoardEvent =
  | BoardCreatedEvent
  | BoardRenamedEvent
  | BoardArchivedEvent
  | BoardUnarchivedEvent
  | BoardVisibilityChangedEvent;
