// packages/domain/src/contracts/move-card.result.ts

import type { DomainFailure } from "../errors/domain-failure";
import type {
  ListId,
  Revision,
  Sequence,
} from "../shared/ids";

export type MoveCardSuccessResult = Readonly<{
  success: true;

  boardSequence: Sequence;

  updatedListRevisions: Readonly<
    Partial<Record<ListId, Revision>>
  >;

  replayed?: boolean;
}>;

export type MoveCardResult =
  | MoveCardSuccessResult
  | DomainFailure;