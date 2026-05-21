// apps/web/src/features/board/store/sync/tabAuthority/sharedProjectionSync.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared Projection Sync — leader broadcasts state patches to follower tabs.
//
// Leader publishes:
//   STATE_PATCH       — small incremental patch after each WS event
//   SEQUENCE_UPDATE   — new boardSequence after each event applied
//   FULL_STATE_SYNC   — entire projection (on follower request or reconnect)
//
// Follower applies:
//   Patches directly to useBoardStore (no WS connection needed)
//   Requests FULL_STATE_SYNC if it misses too many patches
// ─────────────────────────────────────────────────────────────────────────────

import type { AuthorityBus } from "./authorityBus";
import type { BoardStoreState } from "../../useBoardStore";

const MAX_PATCH_QUEUE = 50;

export interface StatePatch {
  boardSequence: string;
  patch: Partial<Pick<BoardStoreState, "lists" | "cards" | "cardsByList" | "listOrder">>;
}

export type StoreApplyFn = (patch: Partial<BoardStoreState>) => void;

export class SharedProjectionSync {
  private missedPatches = 0;

  constructor(
    private readonly bus: AuthorityBus,
    private readonly isLeader: () => boolean,
    private readonly getState: () => BoardStoreState,
    private readonly applyPatch: StoreApplyFn,
  ) {
    bus.subscribe((msg) => {
      switch (msg.type) {
        case "STATE_PATCH":
          if (!this.isLeader()) this.applyIncomingPatch(msg.payload as StatePatch);
          break;
        case "FULL_STATE_SYNC":
          if (!this.isLeader()) this.applyFullSync(msg.payload as BoardStoreState);
          break;
        case "REQUEST_STATE_SYNC":
          if (this.isLeader()) this.broadcastFullState();
          break;
        case "SEQUENCE_UPDATE":
          if (!this.isLeader()) {
            const seq = (msg.payload as { sequence: string })?.sequence;
            if (seq) this.applyPatch({ boardSequence: seq });
          }
          break;
      }
    });
  }

  /** Called by leader after applying each WS event */
  broadcastPatch(patch: StatePatch): void {
    if (!this.isLeader()) return;
    this.bus.post("STATE_PATCH", patch);
    this.bus.post("SEQUENCE_UPDATE", { sequence: patch.boardSequence });
  }

  /** Called by leader to share full state (e.g. after resync) */
  broadcastFullState(): void {
    if (!this.isLeader()) return;
    const state = this.getState();
    // Only broadcast projection fields — skip runtime state
    const projection: Partial<BoardStoreState> = {
      lists:         state.lists,
      cards:         state.cards,
      cardsByList:   state.cardsByList,
      listOrder:     state.listOrder,
      boardSequence: state.boardSequence,
    };
    this.bus.post("FULL_STATE_SYNC", projection);
  }

  /** Called by follower on mount or after missing too many patches */
  requestFullSync(): void {
    if (this.isLeader()) return;
    this.bus.post("REQUEST_STATE_SYNC");
  }

  private applyIncomingPatch(patch: StatePatch | undefined): void {
    if (!patch) return;
    this.missedPatches = 0;
    this.applyPatch(patch.patch as Partial<BoardStoreState>);
    this.applyPatch({ boardSequence: patch.boardSequence });
  }

  private applyFullSync(state: BoardStoreState | undefined): void {
    if (!state) return;
    this.missedPatches = 0;
    this.applyPatch(state);
  }
}
