// apps/web/src/infrastructure/platform/eventBus.ts
//
// Global platform event bus. All domain events, automation triggers,
// plugin hooks, and AI agent inputs flow through this single bus.

import type { AppDomainEvent } from "@repo/domain";
import { telemetry } from "@/lib/telemetry/logEvent";

export type BusEventKind = "domain" | "automation" | "plugin" | "agent" | "system";

export interface BusEvent<T = unknown> {
  readonly id: string;
  readonly kind: BusEventKind;
  readonly type: string;
  readonly payload: T;
  readonly timestamp: number;
  readonly tenantId?: string;
  readonly correlationId?: string;
}

export type BusSubscriber<T = unknown> = (event: BusEvent<T>) => void | Promise<void>;

export interface SubscriptionOptions {
  readonly kind?: BusEventKind;
  readonly typePrefix?: string;
  readonly subscriberId: string;
}

interface Subscription {
  readonly id: string;
  readonly options: SubscriptionOptions;
  readonly handler: BusSubscriber<any>;
}

export class PlatformEventBus {
  private subscriptions: Subscription[] = [];
  private history: BusEvent[] = [];
  private readonly MAX_HISTORY = 1000;

  publish<T>(event: BusEvent<T>): void {
    this.history.push(event as BusEvent);
    if (this.history.length > this.MAX_HISTORY) this.history.shift();

    const matching = this.subscriptions.filter((sub) => this._matches(sub, event));
    for (const sub of matching) {
      try {
        const result = sub.handler(event);
        if (result instanceof Promise) {
          result.catch((err) => {
            telemetry.log("STORE", "EVENT_BUS_SUBSCRIBER_ERROR", {
              subscriberId: sub.id, eventType: event.type, error: String(err),
            });
          });
        }
      } catch (err) {
        telemetry.log("STORE", "EVENT_BUS_SUBSCRIBER_SYNC_ERROR", {
          subscriberId: sub.id, eventType: event.type, error: String(err),
        });
      }
    }
  }

  publishDomainEvent(event: AppDomainEvent, tenantId?: string): void {
    this.publish({
      id: event.id, kind: "domain", type: event.type,
      payload: event.payload, timestamp: Date.now(),
      tenantId: tenantId ?? event.tenantId, correlationId: event.correlationId,
    });
  }

  subscribe<T>(options: SubscriptionOptions, handler: BusSubscriber<T>): () => void {
    const sub: Subscription = { id: options.subscriberId, options, handler };
    this.subscriptions.push(sub);
    return () => { const idx = this.subscriptions.indexOf(sub); if (idx !== -1) this.subscriptions.splice(idx, 1); };
  }

  getHistory(): readonly BusEvent[] { return this.history; }
  clearSubscriptions(): void { this.subscriptions = []; }

  private _matches(sub: Subscription, event: BusEvent): boolean {
    const { kind, typePrefix } = sub.options;
    if (kind && event.kind !== kind) return false;
    if (typePrefix && !event.type.startsWith(typePrefix)) return false;
    return true;
  }
}

export const eventBus = new PlatformEventBus();
