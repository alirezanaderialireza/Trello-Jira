// packages/domain/src/contracts/move-card.command.ts

import type { CommandMetadata } from "../shared/command-metadata";
import type {
  CardId,
  ListId,
  Revision,
} from "../shared/ids";

export type MoveCardMode =
  | "APPEND"
  | "PREPEND"
  | "INSERT_BETWEEN"
  | "REORDER_SAME_LIST";

export type MoveCardCommand = Readonly<
  CommandMetadata & {
    cardId: CardId;

    targetListId: ListId;

    mode: MoveCardMode;

    prevId?: CardId;

    nextId?: CardId;

    expectedAclVersion?: Revision;

    expectedListRevisions?: Readonly<
      Partial<Record<ListId, Revision>>
    >;
  }
>;