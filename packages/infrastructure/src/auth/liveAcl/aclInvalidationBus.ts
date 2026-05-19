// packages/infrastructure/src/auth/liveAcl/aclInvalidationBus.ts
// ─────────────────────────────────────────────────────────────────────────────
// ACL Invalidation Bus — Redis pub/sub for real-time ACL change propagation.
//
// When a board member's role is changed or removed, ALL active API nodes and
// WS servers must evict their caches and revalidate any live sessions/connections.
//
// Message types published:
//   ACL_MEMBER_CHANGED    — role changed for userId on boardId
//   ACL_MEMBER_REMOVED    — userId removed from boardId
//   ACL_BOARD_ARCHIVED    — entire board archived → evict all sessions
//   ACL_CARD_LOCKED       — card locked → re-check card:update permissions
//   SESSION_REVOKE        — a specific session must be invalidated immediately
// ─────────────────────────────────────────────────────────────────────────────

import type { Redis } from "ioredis";

export type AclInvalidationEventType =
  | "ACL_MEMBER_CHANGED"
  | "ACL_MEMBER_REMOVED"
  | "ACL_BOARD_ARCHIVED"
  | "ACL_CARD_LOCKED"
  | "SESSION_REVOKE";

export interface AclInvalidationEvent {
  type:      AclInvalidationEventType;
  tenantId:  string;
  boardId?:  string;
  cardId?:   string;
  userId?:   string;
  sessionId?: string;
  newRole?:  string;
  timestamp: number;
}

export const ACL_INVALIDATION_CHANNEL = "acl:invalidation";

export type AclInvalidationHandler = (event: AclInvalidationEvent) => void | Promise<void>;

// ============================================================================
// AclInvalidationBus — publisher
// ============================================================================

export class AclInvalidationBus {
  private handlers = new Set<AclInvalidationHandler>();
  private subClient: Redis | null = null;

  constructor(private readonly publisher: Redis) {}

  // Publish an invalidation event to all API/WS nodes
  async publish(event: Omit<AclInvalidationEvent, "timestamp">): Promise<void> {
    const payload: AclInvalidationEvent = { ...event, timestamp: Date.now() };
    await this.publisher.publish(ACL_INVALIDATION_CHANNEL, JSON.stringify(payload));
  }

  // Subscribe to invalidation events (call on each API/WS server startup)
  subscribe(subRedis: Redis, handler: AclInvalidationHandler): () => void {
    this.subClient = subRedis;
    this.handlers.add(handler);

    if (this.handlers.size === 1) {
      subRedis.subscribe(ACL_INVALIDATION_CHANNEL).catch(() => undefined);
      subRedis.on("message", (channel, msg) => {
        if (channel !== ACL_INVALIDATION_CHANNEL) return;
        try {
          const ev = JSON.parse(msg) as AclInvalidationEvent;
          for (const h of this.handlers) {
            Promise.resolve(h(ev)).catch(() => undefined);
          }
        } catch { /**/ }
      });
    }

    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0) {
        subRedis.unsubscribe(ACL_INVALIDATION_CHANNEL).catch(() => undefined);
      }
    };
  }

  // Convenience: publish member role change
  async publishMemberChanged(params: {
    tenantId: string; boardId: string; userId: string; newRole: string;
  }): Promise<void> {
    await this.publish({ type: "ACL_MEMBER_CHANGED", ...params });
  }

  // Convenience: publish member removal
  async publishMemberRemoved(params: {
    tenantId: string; boardId: string; userId: string;
  }): Promise<void> {
    await this.publish({ type: "ACL_MEMBER_REMOVED", ...params });
  }

  // Convenience: publish session revoke
  async publishSessionRevoke(params: {
    tenantId: string; sessionId: string; userId: string;
  }): Promise<void> {
    await this.publish({ type: "SESSION_REVOKE", ...params });
  }
}
