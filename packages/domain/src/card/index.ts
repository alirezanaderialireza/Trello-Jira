// packages/domain/src/card/index.ts
//
// Public barrel for the card slice. Mirrors the labels-feature pattern
// from F1.2.1 so a future card-feature use case lands in one canonical
// place. Consumers `import { Card, setCardDueDate } from "@repo/domain"`
// — they don't reach into individual files.

export * from "./types";
export * from "./use-cases/setCardDueDate";
