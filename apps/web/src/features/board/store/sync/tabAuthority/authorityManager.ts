// apps/web/src/features/board/store/sync/tabAuthority/authorityManager.ts
// ─────────────────────────────────────────────────────────────────────────────
// Authority Manager — top-level coordinator for single-tab authority.
//
// Wires together:
//   AuthorityBus + LeaderElection + SharedProjectionSync
//
// Exported as a singleton per board via `getAuthorityManager(boardId)`.
//
// Integration with useSyncOrchestrator:
//   - If this tab is leader  → connect WS, own outbox, run replay
//   - If this tab is follower → skip WS/outbox, receive patches from leader
//
// Result: exactly one active WebSocket per browser, regardless of tab count.
// ─────────────────────────────────────────────────────────────────────────────

import { AuthorityBus } from "./authorityBus";
import { LeaderElection } from "./leaderElection";
import { SharedProjectionSync } from "./sharedProjectionSync";
import type { BoardStoreState } from "../../useBoardStore";

export interface AuthorityManagerOptions {
  boardId:     string;
  tabId:       string;
  getState:    () => BoardStoreState;
  applyPatch:  (patch: Partial<BoardStoreState>) => void;
  onBecomeLeader:   () => void;
  onLoseLeadership: () => void;
}

export class AuthorityManager {
  readonly bus:       AuthorityBus;
  readonly election:  LeaderElection;
  readonly projSync:  SharedProjectionSync;

  private readonly leaderUnsub: () => void;

  constructor(private readonly opts: AuthorityManagerOptions) {
    this.bus      = new AuthorityBus(opts.boardId, opts.tabId);
    this.election = new LeaderElection(opts.boardId, opts.tabId, this.bus);
    this.projSync = new SharedProjectionSync(
      this.bus,
      () => this.election.getIsLeader(),
      opts.getState,
      opts.applyPatch,
    );

    this.leaderUnsub = this.election.onLeadershipChange((isLeader) => {
      if (isLeader) {
        opts.onBecomeLeader();
      } else {
        opts.onLoseLeadership();
        // Follower: request latest state from new leader
        this.projSync.requestFullSync();
      }
    });
  }

  get isLeader(): boolean { return this.election.getIsLeader(); }

  destroy(): void {
    this.leaderUnsub();
    this.election.destroy();
    this.bus.destroy();
  }
}

// ── Singleton registry ────────────────────────────────────────────────────────

const registry = new Map<string, AuthorityManager>();

export function getAuthorityManager(boardId: string): AuthorityManager | null {
  return registry.get(boardId) ?? null;
}

export function createAuthorityManager(opts: AuthorityManagerOptions): AuthorityManager {
  registry.get(opts.boardId)?.destroy();
  const mgr = new AuthorityManager(opts);
  registry.set(opts.boardId, mgr);
  return mgr;
}

export function destroyAuthorityManager(boardId: string): void {
  registry.get(boardId)?.destroy();
  registry.delete(boardId);
}
