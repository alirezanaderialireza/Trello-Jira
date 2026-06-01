// apps/web/src/lib/checklists/computeProgress.ts
//
// Pure derivation of checklist progress (done count, total, percent).
// Used by:
//   • ChecklistProgressBar (header in card-detail)
//   • CardItem badge (compact "3/5" preview)
//   • Future: filter-by-completion (Phase 2 polish)
//
// Lives in shared territory because two consumers across feature
// boundaries (features/board CardItem + apps/web/src/components/
// checklists ChecklistProgressBar) need it. Cross-feature import ban
// from PR #46 forced the hoist; same precedent as
// `apps/web/src/lib/labels/`.

/** Minimum shape we need from a checklist item to compute progress. */
export interface ProgressItem {
  readonly isDone: boolean;
}

export interface Progress {
  readonly done:    number;
  readonly total:   number;
  /** Integer percent in [0, 100]. 0 when total === 0 (avoids NaN). */
  readonly percent: number;
}

/**
 * Compute progress for a flat list of items.
 *
 * Edge cases:
 *   • Empty list → { done: 0, total: 0, percent: 0 } (NOT NaN — divide-by-zero guard).
 *   • All done   → { ..., percent: 100 }.
 *   • Mixed     → percent is rounded to the nearest integer.
 */
export function computeProgress(
  items: readonly ProgressItem[],
): Progress {
  const total = items.length;
  if (total === 0) {
    return { done: 0, total: 0, percent: 0 };
  }

  let done = 0;
  for (const item of items) {
    if (item.isDone) done++;
  }

  // Math.round (not floor) gives the friendliest UX:
  // 1/3 → 33% (rounds 33.33 down)
  // 2/3 → 67% (rounds 66.67 up)
  // 4/5 → 80%, 5/5 → 100%
  const percent = Math.round((done / total) * 100);

  return { done, total, percent };
}

/**
 * Convenience aggregator for a card with multiple checklists. Sums
 * done + total across every checklist's items. Used by the CardItem
 * badge to show "3/5" for the whole card (Master Contract D18).
 */
export function aggregateCardProgress(
  checklists: readonly { items: readonly ProgressItem[] }[],
): Progress {
  let done  = 0;
  let total = 0;
  for (const checklist of checklists) {
    for (const item of checklist.items) {
      total++;
      if (item.isDone) done++;
    }
  }
  if (total === 0) return { done: 0, total: 0, percent: 0 };
  return { done, total, percent: Math.round((done / total) * 100) };
}
