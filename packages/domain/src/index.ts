// packages/domain/src/index.ts

// 1️⃣ Core Entities
export * from "./card";
export * from "./list/types";
export * from "./board/types";
export * from "./events";

// 2️⃣ Shared Branded Types & Command Metadata
export * from "./shared/ids";
export * from "./shared/command-metadata";
export * from "./shared/date-types";

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

// 🔟 Labels (Phase 1.2 — F1.2.1)
export * from "./labels";

// 1️⃣1️⃣ Checklists (Phase 1.2 — F1.2.3)
export * from "./checklists";

// 1️⃣2️⃣ Comments (Phase 1.2 — F1.2.4)
export * from "./comments";