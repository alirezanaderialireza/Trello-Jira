// packages/domain/src/labels/index.ts
//
// Public barrel for the labels slice. Importers should never reach into
// individual files — adding `export * from "./labels"` to the package
// root is enough to surface the whole API.

export * from "./types";
export * from "./errors";
export * from "./use-cases/createLabel";
export * from "./use-cases/updateLabel";
export * from "./use-cases/deleteLabel";
export * from "./use-cases/applyLabelToCard";
export * from "./use-cases/removeLabelFromCard";
