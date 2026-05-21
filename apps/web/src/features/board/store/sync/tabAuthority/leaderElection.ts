// apps/web/src/features/board/store/sync/tabAuthority/leaderElection.ts
// ─────────────────────────────────────────────────────────────────────────────
// Leader Election — determines which tab owns the WebSocket / outbox / replay.
//
// Algorithm: "lowest tabId wins" (lexicographic — deterministic, no coordination needed)
//   1. On startup each tab generates a random UUID (tabId).
//   2. Each tab sends LEADER_ELECT with its tabId.
//   3. A tab becomes leader if, after ELECTION_GRACE_MS, no other tab has sent
//      a smaller tabId.
//   4. The leader sends LEADER_HEARTBEAT every HEARTBEAT_INTERVAL_MS.
//   5. Followers monitor for heartbeat. If LEASE_DURATION_MS passes without one,
//      they start a new election.
//   6. When a leader tab closes (beforeunload), it sends LEADER_RESIGN.
//
// SessionStorage is used as a fast same-origin fallback to avoid unnecessary
// elections when there is truly only one tab.
// ─────────────────────────────────────────────────────────────────────────────

import type { AuthorityBus } from "./authorityBus";

const HEARTBEAT_INTERVAL_MS = 2_000;
const LEASE_DURATION_MS      = 5_000;  // If no heartbeat for 5s → re-elect
const ELECTION_GRACE_MS      = 300;   // Wait this long for competing ELECT msgs
const STORAGE_LEADER_KEY     = (boardId: string) => `leader:${boardId}`;

export type LeadershipChangeHandler = (isLeader: boolean) => void;

export class LeaderElection {
  private isLeader           = false;
  private knownLeaderId: string | null = null;
  private lastHeartbeatAt    = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private leaseCheckTimer: ReturnType<typeof setInterval> | null = null;
  private electionTimer: ReturnType<typeof setTimeout> | null = null;
  private candidateTabs      = new Map<string, number>(); // tabId → timestamp
  private handlers           = new Set<LeadershipChangeHandler>();
  private readonly unsubBus: () => void;

  constructor(
    private readonly boardId: string,
    private readonly tabId: string,
    private readonly bus: AuthorityBus,
  ) {
    this.unsubBus = bus.subscribe((msg) => this.handleMessage(msg));
    this.startElection();
    window.addEventListener("beforeunload", this.onBeforeUnload);
  }

  getIsLeader(): boolean { return this.isLeader; }
  getLeaderId(): string | null { return this.knownLeaderId; }

  onLeadershipChange(handler: LeadershipChangeHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  destroy(): void {
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    this.clearTimers();
    if (this.isLeader) {
      this.bus.post("LEADER_RESIGN");
      this.resignLeadership();
    }
    this.unsubBus();
    this.handlers.clear();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private startElection(): void {
    this.candidateTabs.clear();
    this.candidateTabs.set(this.tabId, Date.now());
    this.bus.post("LEADER_ELECT", { tabId: this.tabId });

    // After grace period, evaluate who won
    this.electionTimer = setTimeout(() => this.resolveElection(), ELECTION_GRACE_MS);
  }

  private resolveElection(): void {
    // Winner = lexicographically smallest tabId (deterministic)
    const winner = [...this.candidateTabs.keys()].sort()[0];
    if (winner === this.tabId) {
      this.assumeLeadership();
    } else {
      this.knownLeaderId = winner ?? null;
    }
  }

  private assumeLeadership(): void {
    this.isLeader       = true;
    this.knownLeaderId  = this.tabId;
    this.lastHeartbeatAt = Date.now();
    this.notifyHandlers(true);
    this.bus.post("LEADER_ELECT", { tabId: this.tabId }); // final announcement
    this.storeLeaderInSession();
    this.startHeartbeat();
    this.stopLeaseCheck();
  }

  private resignLeadership(): void {
    this.isLeader = false;
    this.clearSessionLeader();
    this.notifyHandlers(false);
    this.stopHeartbeat();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.bus.post("LEADER_HEARTBEAT", { tabId: this.tabId });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private startLeaseCheck(): void {
    this.stopLeaseCheck();
    this.lastHeartbeatAt = Date.now();
    this.leaseCheckTimer = setInterval(() => {
      if (Date.now() - this.lastHeartbeatAt > LEASE_DURATION_MS) {
        this.startElection();
      }
    }, LEASE_DURATION_MS / 2);
  }

  private stopLeaseCheck(): void {
    if (this.leaseCheckTimer) clearInterval(this.leaseCheckTimer);
    this.leaseCheckTimer = null;
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    this.stopLeaseCheck();
    if (this.electionTimer) clearTimeout(this.electionTimer);
    this.electionTimer = null;
  }

  private handleMessage(msg: { type: string; payload?: unknown }): void {
    const payload = msg.payload as Record<string, string> | undefined;
    const senderId = payload?.["tabId"] ?? "";

    switch (msg.type) {
      case "LEADER_ELECT":
        this.candidateTabs.set(senderId, Date.now());
        // If a smaller ID comes during election, we won't win — extend grace
        if (senderId < this.tabId && !this.electionTimer) {
          this.knownLeaderId = senderId;
          if (this.isLeader) {
            this.bus.post("LEADER_RESIGN");
            this.resignLeadership();
          }
        }
        break;

      case "LEADER_HEARTBEAT":
        this.lastHeartbeatAt = Date.now();
        this.knownLeaderId   = senderId;
        if (!this.isLeader) this.startLeaseCheck();
        break;

      case "LEADER_RESIGN":
        if (this.knownLeaderId === senderId) {
          this.knownLeaderId = null;
          this.stopLeaseCheck();
          this.startElection();
        }
        break;
    }
  }

  private notifyHandlers(isLeader: boolean): void {
    for (const h of this.handlers) {
      try { h(isLeader); } catch { /* isolation */ }
    }
  }

  private readonly onBeforeUnload = (): void => {
    if (this.isLeader) {
      this.bus.post("LEADER_RESIGN");
      this.clearSessionLeader();
    }
  };

  private storeLeaderInSession(): void {
    try { sessionStorage.setItem(STORAGE_LEADER_KEY(this.boardId), this.tabId); } catch { /**/ }
  }

  private clearSessionLeader(): void {
    try { sessionStorage.removeItem(STORAGE_LEADER_KEY(this.boardId)); } catch { /**/ }
  }
}
