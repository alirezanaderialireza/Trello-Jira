---
inclusion: manual
---

# Board Engine Conventions (F1.3)

The board UI consumes a single facade, `useBoardEngine(boardId)`, built from
four internal engines. This keeps `BoardView` thin and the powerful core
engines (sync FSM, positioning, mutation lifecycle) untouched.

```
                 useBoardEngine(boardId)            ← the only thing the UI imports
                 ┌───────────┬───────────┬───────────┬──────────────┐
                 │useBoardState│useDragEngine│useSyncEngine│useResilience│
                 └───────────┴───────────┴───────────┴──────────────┘
                       │            │             │            │
            granular selectors  dnd-kit      useSyncOrchestrator  memory/virtualization
            (atomic, memoised)  lifecycle    (existing FSM)       traps + mobile
```

## Engine responsibilities

| Engine          | Owns                                                              | Status |
|-----------------|------------------------------------------------------------------|--------|
| `useBoardState` | Atomic store selectors + derived ordered lists.                  | F1.3.1 ✅ |
| `useDragEngine` | dnd-kit lifecycle (start/over/end), intent debounce, sensors.    | F1.3.2 ✅ |
| `useSyncEngine` | Thin wrapper over the existing `useSyncOrchestrator`.            | F1.3.3 ✅ |
| `useResilience` | Memory cleanup, virtualization trap, viewport-shift + flush.     | F1.3.4 ✅ |

## F1.3.1 — Selector conventions (implemented)

- Pure selector factories live in `engine/boardSelectors.ts` with **no runtime
  imports** (store/React types are `import type`, erased at compile time). This
  makes them unit-testable without a React tree or a Zustand instance.
- `engine/useBoardState.ts` wraps each id-scoped factory in `useMemo([id])` so
  the Zustand subscription path stays referentially stable.
- Collection selectors return a module-level frozen `EMPTY_CARD_IDS` for a
  missing slice — never a fresh `[]` (which would defeat Zustand's `Object.is`
  bail-out and cause render loops).
- `useDerivedLists` subscribes to exactly `listOrder` + `lists` and memoises
  the projection. **No component subscribes to the whole board object.**
- Components (`ListColumn`, `CardItem`) import these hooks instead of declaring
  inline `makeSelect*` factories.

## Hard guards (apply to every F1.3 sub-phase)

- No changes to the core engines: sync FSM, `positioningEngine`,
  `MutationLifecycleManager`, `useOptimisticMutation`, `createSnapshot`.
- A single move path: all card/list moves go through `useMoveCard` /
  `useMoveList`. No component calls `moveCardAction` directly.
- No manual `setState` rollback or `structuredClone` in components — the
  mutation lifecycle owns rollback.
- Frontend only: no migrations, no API/DB changes.
- User-facing behaviour is unchanged — this is a structural refactor.
- RTL / Persian preserved.

## Tests

- `engine/__tests__/boardSelectors.test.ts` — selector correctness + stability.
- `engine/__tests__/intentScheduler.test.ts` — debounce window (fake clock).
- `engine/__tests__/dragResolution.test.ts` — drop-index / container math.
- Existing `store/__tests__/*` must keep passing (regression gate).

## F1.3.2 — Drag engine (implemented, not yet wired)

- `engine/intentScheduler.ts` — pure 120ms debounce primitive with injectable
  timers (so it is deterministically testable).
- `engine/dragResolution.ts` — pure index/container resolution helpers.
- `engine/useDragEngine.ts` — composes the above with `useMoveCard` /
  `useMoveList` (the single move path, D3), `useBoardStore.moveCard` for the
  visual-only over-feedback, and Pointer/Touch/Keyboard sensors (D7/D8).
  Authored additive; BoardView is rewired to consume it in F1.3.3.


## F1.3.3 — Facade + thin BoardView (implemented)

- `engine/useBoardEngine.ts` — the single facade the UI consumes. Composes
  useBoardState + useDragEngine + useSyncOrchestrator (existing) + usePendingGC
  + useBoardPresence. Returns `{ listOrder, initBoard, dndProps, activeId,
  activeType, dragMeta, isDragging, triggerManualReconnect, presenceUserId }`.
- `hooks/useHydrateBoard.ts` — extracted hydration effect (versionHash +
  enrichedLists → initBoard) + SSR mount guard.
- `hooks/useDeleteCardWithUndo.ts` — extracted delete-with-undo (separate
  concern from move rollback).
- `components/BoardCanvas.tsx` — SortableContext rail + CreateListForm; owns
  the virtualization decision point (D5, wired in F1.3.4).
- `components/BoardDragOverlay.tsx` — overlay clone sized to the captured
  rect for cards (D6).
- `components/BoardView.tsx` — rewritten ~700 → ~120 lines, purely
  presentational. The parallel `moveCardAction`/`moveListAction` path and the
  manual `setState`/`structuredClone` rollback are gone; all moves go through
  the drag engine's unified useMoveCard/useMoveList (D3, D10).
- Deleted the deprecated `features/board/pages/BoardPage.tsx` stub (D6/T6).

Validation note: BoardView integration is exercised by the manual runbook
(drag, rollback, click-vs-drag, list move). It is not covered by an automated
test because CI does not run web component tests and the offline sandbox has
no browser; the pure logic underneath (selectors, intent scheduler, drop
resolution) is unit-tested.


## F1.3.4 — Resilience + mobile (implemented, with one parked item)

- `engine/useResilience.ts` — exposes the module-level `boardDragState`
  singleton (the virtualization overscan trap flag, read synchronously during
  scroll math) and a tab-lifecycle (`visibilitychange`/`pagehide`) seam. It is
  deliberately non-destructive: pending mutations already survive in the store
  + MutationLifecycleManager + outbox processor, so the hide handler is a
  documented flush seam, not a state mutation. All its listeners are torn down
  on unmount.
- `engine/useViewportShiftGuard.ts` — touch-only (coarse pointer) guard that
  recenters a focused input after the keyboard opens and marks `data-vp-shift`
  on `<body>`; desktop is untouched. Fully self-cleaning.
- Both are wired into `useBoardEngine`.

### PARKED — virtualization activation (D5/T2/T3)

`components/virtualized/VirtualizedBoard.tsx` renders lists/cards with scroll
virtualization but **does not integrate dnd-kit's `SortableContext`** (no
sortable items, static "+ Add a card"). Activating it for boards with > 10
lists would therefore **remove drag-and-drop on large boards — a regression**.

Decision: BoardCanvas keeps the standard render path (the D5 decision point is
in place and documented). Activating virtualization requires first reworking
VirtualizedBoard/VirtualizedListColumn to:
  1. wrap lists/cards in `SortableContext` and use the sortable hooks,
  2. read `boardDragState.isDragging` to widen overscan during a drag (the trap),
  3. be validated in a real browser (DOM-node counts, 60fps scroll, no
     mid-drag unmount).
This is a focused follow-up that needs runtime validation and is out of scope
for the offline refactor PRs.

### Validation status (F1.3 overall)

- Unit-tested (run locally via node type-strip; vitest in repo): selectors,
  intent scheduler, drop resolution.
- Manual runbook required (no browser / no web component tests in CI): drag
  behaviour, rollback, click-vs-drag, mobile touch/scroll, viewport shift,
  multi-tab convergence, memory profile.
