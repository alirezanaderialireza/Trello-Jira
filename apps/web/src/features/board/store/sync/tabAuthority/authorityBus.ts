// apps/web/src/features/board/store/sync/tabAuthority/authorityBus.ts
// ─────────────────────────────────────────────────────────────────────────────
// Authority Bus — typed BroadcastChannel wrapper for cross-tab communication.
//
// Every message on the "board-authority" channel passes through here.
// This is the single I/O boundary between tabs.
// ─────────────────────────────────────────────────────────────────────────────

export type AuthorityMessageType =
  | "LEADER_HEARTBEAT"    // Leader announces it is alive
  | "LEADER_ELECT"        // Tab claims leadership
  | "LEADER_RESIGN"       // Leader voluntarily gives up (e.g. tab close)
  | "ELECTION_START"      // Follower starts election after lease expired
  | "STATE_PATCH"         // Leader broadcasts incremental state patch
  | "SEQUENCE_UPDATE"     // Leader broadcasts latest board sequence
  | "FULL_STATE_SYNC"     // Leader sends full state snapshot (follower catch-up)
  | "MUTATION_ACK"        // Leader notifies followers a mutation was ACK'd
  | "MUTATION_FAIL"       // Leader notifies followers a mutation failed
  | "REQUEST_STATE_SYNC"; // Follower requests full state from leader

export interface AuthorityMessage<T extends AuthorityMessageType = AuthorityMessageType> {
  type: T;
  tabId: string;
  boardId: string;
  timestamp: number;
  payload?: unknown;
}

export type AuthorityMessageHandler = (msg: AuthorityMessage) => void;

const CHANNEL_NAME = "board-authority";

export class AuthorityBus {
  private channel: BroadcastChannel | null = null;
  private handlers = new Set<AuthorityMessageHandler>();
  private readonly boardId: string;
  private readonly tabId: string;

  constructor(boardId: string, tabId: string) {
    this.boardId = boardId;
    this.tabId   = tabId;
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (ev) => this.handleIncoming(ev.data as AuthorityMessage);
    }
  }

  /** Post a message to all other tabs on this board */
  post<T extends AuthorityMessageType>(type: T, payload?: unknown): void {
    const msg: AuthorityMessage<T> = {
      type,
      tabId:     this.tabId,
      boardId:   this.boardId,
      timestamp: Date.now(),
      payload,
    };
    this.channel?.postMessage(msg);
  }

  /** Subscribe to incoming messages from other tabs */
  subscribe(handler: AuthorityMessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  destroy(): void {
    this.handlers.clear();
    this.channel?.close();
    this.channel = null;
  }

  private handleIncoming(msg: AuthorityMessage): void {
    // Only forward messages for this board; ignore own messages
    if (msg.boardId !== this.boardId || msg.tabId === this.tabId) return;
    for (const h of this.handlers) {
      try { h(msg); } catch { /* observer isolation */ }
    }
  }
}
