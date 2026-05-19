// apps/web/src/features/board/store/test-utils/generators.ts
// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Random Event Stream Generators for Property-Based Testing.
//
// Design:
//   - Seeded PRNG (Linear Congruential Generator) → reproducible failures
//   - Generates BoardStoreState + event streams that are always VALID by default
//   - Can generate INVALID/chaotic streams for fault-tolerance testing
//   - No external dependencies (fast-check, etc.) needed — pure TS
// ─────────────────────────────────────────────────────────────────────────────

import type { BoardStoreState, CardDto, ListDto } from "../useBoardStore";
import type { ClientEventEnvelope } from "../event-application/types";
import type {
  AppDomainEvent,
  CardCreatedEvent,
  CardMovedEvent,
  CardUpdatedEvent,
  CardDeletedEvent,
  ListCreatedEvent,
  ListMovedEvent,
  ListDeletedEvent,
} from "@repo/domain";

// ============================================================================
// Seeded PRNG — Linear Congruential Generator
// ─────────────────────────────────────────────────────────────────────────────
// Same seed → same sequence, always. Essential for reproducible test failures.
// ============================================================================

export class SeededRandom {
  private state: number;

  constructor(seed: number = 42) {
    this.state = seed >>> 0;
  }

  /** Returns float in [0, 1) */
  next(): number {
    // LCG parameters from Numerical Recipes
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  /** Returns integer in [min, max) */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** Returns element from array */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length)]!;
  }

  /** Returns true with given probability */
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  /** Returns shuffled copy of array */
  shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }

  /** Generates a short lexorank-style position string */
  position(index: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz";
    const base = chars[index % 26]!;
    const suffix = index < 26 ? "" : String(Math.floor(index / 26));
    return base + suffix;
  }
}

// ============================================================================
// State Generators
// ============================================================================

export interface GeneratorOptions {
  seed?: number;
  listCount?: { min: number; max: number };
  cardCount?: { min: number; max: number };
  boardId?: string;
  tenantId?: string;
}

const DEFAULTS: Required<GeneratorOptions> = {
  seed: 42,
  listCount: { min: 1, max: 5 },
  cardCount: { min: 0, max: 8 },
  boardId: "board-test",
  tenantId: "tenant-test",
};

/**
 * Generates a valid BoardStoreState with a consistent internal structure.
 * All invariants hold on the generated state.
 */
export function generateBoardState(opts: GeneratorOptions = {}): BoardStoreState {
  const cfg = { ...DEFAULTS, ...opts };
  const rng = new SeededRandom(cfg.seed);

  const lists: Record<string, ListDto> = {};
  const cards: Record<string, CardDto> = {};
  const cardsByList: Record<string, string[]> = {};
  const listOrder: string[] = [];

  const listCount = rng.int(cfg.listCount.min, cfg.listCount.max + 1);

  for (let li = 0; li < listCount; li++) {
    const listId = `list-${li}`;
    lists[listId] = {
      id: listId,
      boardId: cfg.boardId,
      title: `List ${li}`,
      position: rng.position(li),
      revision: rng.int(1, 10),
    };
    listOrder.push(listId);
    cardsByList[listId] = [];

    const cardCount = rng.int(cfg.cardCount.min, cfg.cardCount.max + 1);
    for (let ci = 0; ci < cardCount; ci++) {
      const cardId = `card-${li}-${ci}`;
      cards[cardId] = {
        id: cardId,
        boardId: cfg.boardId,
        listId,
        title: `Card ${li}-${ci}`,
        position: rng.position(ci),
        revision: rng.int(1, 10),
      };
      cardsByList[listId].push(cardId);
    }
  }

  return {
    lists,
    cards,
    cardsByList,
    listOrder,
    boardSequence: String(rng.int(0, 1000)),
    bufferedEvents: {},
    syncStatus: "synced",
    pendingMutations: {},
  };
}

// ============================================================================
// Event Envelope Generators
// ============================================================================

let _eventSeq = 1;
function nextEventId(): string {
  return `evt-${_eventSeq++}`;
}
export function resetEventSeq(): void {
  _eventSeq = 1;
}

function makeEnvelope<TEvent extends AppDomainEvent>(
  event: TEvent,
  optimistic = false,
): ClientEventEnvelope<TEvent> {
  return { event, optimistic, acknowledged: !optimistic };
}

/**
 * Generates a valid card.created envelope using IDs that exist in state.
 * If state has no valid lists, returns null.
 */
export function generateCardCreatedEnvelope(
  state: BoardStoreState,
  rng: SeededRandom,
): ClientEventEnvelope<CardCreatedEvent> | null {
  const listIds = Object.keys(state.lists);
  if (listIds.length === 0) return null;

  const listId = rng.pick(listIds);
  const existingCards = Object.values(state.cards).filter((c) => c.listId === listId);
  const cardId = `card-new-${rng.int(1000, 9999)}`;

  // Ensure unique position
  const existingPositions = new Set(existingCards.map((c) => c.position));
  let position = rng.position(rng.int(0, 26));
  let attempts = 0;
  while (existingPositions.has(position) && attempts < 52) {
    position = rng.position(rng.int(0, 52));
    attempts++;
  }

  return makeEnvelope<CardCreatedEvent>({
    id: nextEventId(),
    type: "card.created",
    version: 1,
    occurredAt: new Date().toISOString(),
    aggregateId: cardId,
    aggregateType: "card",
    correlationId: `corr-${rng.int(1, 9999)}`,
    tenantId: state.lists[listId]?.boardId ?? "tenant-test",
    payload: {
      cardId,
      listId,
      boardId: state.lists[listId]?.boardId ?? "board-test",
      title: `Generated Card`,
      position,
    },
  });
}

/**
 * Generates a valid card.moved envelope. Returns null if no movable cards.
 */
export function generateCardMovedEnvelope(
  state: BoardStoreState,
  rng: SeededRandom,
): ClientEventEnvelope<CardMovedEvent> | null {
  const cardIds = Object.keys(state.cards);
  if (cardIds.length === 0) return null;

  const listIds = Object.keys(state.lists);
  if (listIds.length === 0) return null;

  const cardId = rng.pick(cardIds);
  const card = state.cards[cardId]!;
  const toListId = rng.pick(listIds);

  return makeEnvelope<CardMovedEvent>({
    id: nextEventId(),
    type: "card.moved",
    version: card.revision + 1,
    occurredAt: new Date().toISOString(),
    aggregateId: cardId,
    aggregateType: "card",
    correlationId: `corr-${rng.int(1, 9999)}`,
    payload: {
      cardId,
      fromListId: card.listId,
      toListId,
      boardId: card.boardId,
      oldPosition: card.position,
      newPosition: rng.position(rng.int(0, 26)),
    },
  });
}

/**
 * Generates a valid card.updated envelope. Returns null if no cards.
 */
export function generateCardUpdatedEnvelope(
  state: BoardStoreState,
  rng: SeededRandom,
): ClientEventEnvelope<CardUpdatedEvent> | null {
  const cardIds = Object.keys(state.cards);
  if (cardIds.length === 0) return null;

  const cardId = rng.pick(cardIds);
  const card = state.cards[cardId]!;

  return makeEnvelope<CardUpdatedEvent>({
    id: nextEventId(),
    type: "card.updated",
    version: card.revision + 1,
    occurredAt: new Date().toISOString(),
    aggregateId: cardId,
    aggregateType: "card",
    correlationId: `corr-${rng.int(1, 9999)}`,
    payload: {
      cardId,
      boardId: card.boardId,
      changes: { title: `Updated-${rng.int(1, 999)}` },
    },
  });
}

/**
 * Generates a valid card.deleted envelope. Returns null if no cards.
 */
export function generateCardDeletedEnvelope(
  state: BoardStoreState,
  rng: SeededRandom,
): ClientEventEnvelope<CardDeletedEvent> | null {
  const cardIds = Object.keys(state.cards);
  if (cardIds.length === 0) return null;

  const cardId = rng.pick(cardIds);
  const card = state.cards[cardId]!;

  return makeEnvelope<CardDeletedEvent>({
    id: nextEventId(),
    type: "card.deleted",
    version: card.revision + 1,
    occurredAt: new Date().toISOString(),
    aggregateId: cardId,
    aggregateType: "card",
    correlationId: `corr-${rng.int(1, 9999)}`,
    payload: { cardId, boardId: card.boardId },
  });
}

/**
 * Generates a valid list.created envelope.
 */
export function generateListCreatedEnvelope(
  state: BoardStoreState,
  rng: SeededRandom,
): ClientEventEnvelope<ListCreatedEvent> {
  const listId = `list-new-${rng.int(1000, 9999)}`;
  const existingPositions = new Set(Object.values(state.lists).map((l) => l.position));
  let position = rng.position(rng.int(0, 26));
  let attempts = 0;
  while (existingPositions.has(position) && attempts < 52) {
    position = rng.position(rng.int(0, 52));
    attempts++;
  }

  const boardId = Object.values(state.lists)[0]?.boardId ?? "board-test";

  return makeEnvelope<ListCreatedEvent>({
    id: nextEventId(),
    type: "list.created",
    version: 1,
    occurredAt: new Date().toISOString(),
    aggregateId: listId,
    aggregateType: "list",
    correlationId: `corr-${rng.int(1, 9999)}`,
    payload: { listId, boardId, title: `Generated List`, position },
  });
}

/**
 * Generates a valid list.deleted envelope. Returns null if no lists.
 */
export function generateListDeletedEnvelope(
  state: BoardStoreState,
  rng: SeededRandom,
): ClientEventEnvelope<ListDeletedEvent> | null {
  const listIds = Object.keys(state.lists);
  if (listIds.length === 0) return null;

  const listId = rng.pick(listIds);
  const boardId = state.lists[listId]?.boardId ?? "board-test";

  return makeEnvelope<ListDeletedEvent>({
    id: nextEventId(),
    type: "list.deleted",
    version: 2,
    occurredAt: new Date().toISOString(),
    aggregateId: listId,
    aggregateType: "list",
    correlationId: `corr-${rng.int(1, 9999)}`,
    payload: { listId, boardId },
  });
}

// ============================================================================
// Random Event Stream Generator
// ─────────────────────────────────────────────────────────────────────────────
// Produces a sequence of event envelopes that can be replayed against a state.
// Each event is generated based on the CURRENT state after applying previous
// events, ensuring referential validity.
// ============================================================================

export type EventStreamEntry = {
  envelope: ClientEventEnvelope;
  stateAfter: BoardStoreState;
};

export interface EventStreamOptions {
  length: number;
  seed?: number;
  /** Probabilities for each event type (must sum to ≤ 1) */
  weights?: {
    cardCreated?: number;
    cardMoved?: number;
    cardUpdated?: number;
    cardDeleted?: number;
    listCreated?: number;
    listDeleted?: number;
  };
}

const DEFAULT_WEIGHTS = {
  cardCreated: 0.25,
  cardMoved: 0.30,
  cardUpdated: 0.20,
  cardDeleted: 0.10,
  listCreated: 0.10,
  listDeleted: 0.05,
};

/**
 * Generates a stream of events and the intermediate states after each one.
 * The applyFn is injected so this generator has no dependency on the dispatcher.
 */
export function generateEventStream(
  initialState: BoardStoreState,
  opts: EventStreamOptions,
  applyFn: (state: BoardStoreState, envelope: ClientEventEnvelope) => Partial<BoardStoreState>,
): EventStreamEntry[] {
  const rng = new SeededRandom(opts.seed ?? 42);
  const weights = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const entries: EventStreamEntry[] = [];

  let currentState = { ...initialState };

  for (let i = 0; i < opts.length; i++) {
    const roll = rng.next();
    let accumulated = 0;

    let envelope: ClientEventEnvelope | null = null;

    if ((accumulated += weights.cardCreated) > roll) {
      envelope = generateCardCreatedEnvelope(currentState, rng);
    } else if ((accumulated += weights.cardMoved) > roll) {
      envelope = generateCardMovedEnvelope(currentState, rng);
    } else if ((accumulated += weights.cardUpdated) > roll) {
      envelope = generateCardUpdatedEnvelope(currentState, rng);
    } else if ((accumulated += weights.cardDeleted) > roll) {
      envelope = generateCardDeletedEnvelope(currentState, rng);
    } else if ((accumulated += weights.listCreated) > roll) {
      envelope = generateListCreatedEnvelope(currentState, rng);
    } else {
      envelope = generateListDeletedEnvelope(currentState, rng);
    }

    if (!envelope) continue; // skip if generator returned null (no valid candidates)

    const patch = applyFn(currentState, envelope);
    const stateAfter = { ...currentState, ...patch };
    entries.push({ envelope, stateAfter });
    currentState = stateAfter;
  }

  return entries;
}
