// packages/domain/src/index.ts

// 1️⃣ Core Entities
export * from "./card/types";
export * from "./list/types";
export * from "./board/types";
export * from "./events";

// 2️⃣ Shared Branded Types & Command Metadata
export * from "./shared/ids";
export * from "./shared/command-metadata";

// 3️⃣ Ordering / LexoRank
export * from "./ordering";

// 4️⃣ Contracts
export * from "./contracts/move-card.command";
export * from "./contracts/move-card.result";

// 5️⃣ Errors / Failures
export * from "./errors/error-codes";
export * from "./errors/domain-failure";

// 6️⃣ Ports / Repository & Logger Interfaces
export * from "./ports";

// 7️⃣ Domain Services (Pure Business Logic)
export * from "./services";

// 8️⃣ List Use Cases
export * from "./list/create-list";
export * from "./list/move-list";

// 9️⃣ Board Use Cases (F3b)
export * from "./board/use-cases/addBoardMember";