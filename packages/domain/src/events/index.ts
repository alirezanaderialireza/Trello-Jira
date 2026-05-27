// packages/domain/src/events/index.ts

/**
 * ------------------------------------------------------------------
 * Domain Events Public API
 * ------------------------------------------------------------------
 * Only import from this barrel — never from individual event files.
 * ------------------------------------------------------------------
 */

export * from "./base";
export * from "./card.events";
export * from "./list.events";
export * from "./board.events";
export * from "./label.events";
export * from "./checklist.events";
export * from "./comment.events";
export * from "./attachment.events";
export * from "./template.events";
export * from "./workspace.events";

import type { CardEvent }       from "./card.events";
import type { ListEvent }       from "./list.events";
import type { BoardEvent }      from "./board.events";
import type { LabelEvent }      from "./label.events";
import type { ChecklistEvent }  from "./checklist.events";
import type { CommentEvent }    from "./comment.events";
import type { AttachmentEvent } from "./attachment.events";
import type { TemplateEvent }   from "./template.events";
import type { WorkspaceEvent }  from "./workspace.events";

/**
 * ------------------------------------------------------------------
 * AppDomainEvent — The Master Union Type
 * ------------------------------------------------------------------
 * Add new aggregate event unions here when new aggregates are added.
 * ------------------------------------------------------------------
 */
export type AppDomainEvent =
  | CardEvent
  | ListEvent
  | BoardEvent
  | LabelEvent
  | ChecklistEvent
  | CommentEvent
  | AttachmentEvent
  | TemplateEvent
  | WorkspaceEvent;
