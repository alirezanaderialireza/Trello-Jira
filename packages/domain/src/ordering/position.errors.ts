// packages/domain/src/ordering/position.errors.ts

export class InvalidPositionError extends Error {
  constructor(message = "Invalid position") {
    super(message);

    this.name = "InvalidPositionError";

    Object.setPrototypeOf(
      this,
      InvalidPositionError.prototype,
    );
  }
}

export class PositionCollisionError extends Error {
  constructor(
    message = "POSITION_COLLISION_RESOLVING",
  ) {
    super(message);

    this.name = "PositionCollisionError";

    Object.setPrototypeOf(
      this,
      PositionCollisionError.prototype,
    );
  }
}

export class InvalidPositionTopologyError extends Error {
  constructor(
    message = "Invalid position topology",
  ) {
    super(message);

    this.name =
      "InvalidPositionTopologyError";

    Object.setPrototypeOf(
      this,
      InvalidPositionTopologyError.prototype,
    );
  }
}

export class CorruptedPositionChainError extends Error {
  constructor(
    message = "Corrupted position chain",
  ) {
    super(message);

    this.name =
      "CorruptedPositionChainError";

    Object.setPrototypeOf(
      this,
      CorruptedPositionChainError.prototype,
    );
  }
}