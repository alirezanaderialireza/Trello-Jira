// packages/domain/src/checklists/index.ts
//
// Public barrel for the checklists slice. Mirrors the labels-feature
// pattern from F1.2.1 — `import { Checklist*, addChecklistItem } from
// "@repo/domain"` is the canonical import path; consumers don't reach
// into individual files.

export * from "./types";
export * from "./errors";
export * from "./use-cases/createChecklist";
export * from "./use-cases/updateChecklist";
export * from "./use-cases/deleteChecklist";
export * from "./use-cases/addChecklistItem";
export * from "./use-cases/updateChecklistItem";
export * from "./use-cases/removeChecklistItem";
