// apps/web/src/infrastructure/platform/automationEngine.ts
// Rule-based automation engine with rate limiting and DLQ.

import { eventBus, type BusEvent } from "./eventBus";
import { telemetry } from "../../features/board/devtools/logEvent";

export type TriggerCondition = (event: BusEvent) => boolean;
export type AutomationAction = (event: BusEvent, ruleId: string) => void | Promise<void>;

export interface AutomationRule {
  readonly id: string;
  readonly name: string;
  readonly tenantId: string;
  readonly boardId?: string;
  readonly triggerTypes: readonly string[];
  readonly condition?: TriggerCondition;
  readonly action: AutomationAction;
  enabled: boolean;
  readonly maxExecutionsPerMinute?: number;
}

interface RuleExecution { ruleId: string; eventId: string; timestamp: number; outcome: "success" | "error" | "rate_limited"; durationMs?: number; error?: string; }

export class AutomationEngine {
  private rules = new Map<string, AutomationRule>();
  private log: RuleExecution[] = [];
  private counts = new Map<string, number[]>();
  private unsub: (() => void) | null = null;

  init(): void { this.unsub = eventBus.subscribe({ subscriberId: "automation-engine", kind: "domain" }, (e) => this._eval(e)); }
  destroy(): void { this.unsub?.(); this.unsub = null; }

  addRule(rule: AutomationRule): void { this.rules.set(rule.id, rule); }
  removeRule(id: string): void { this.rules.delete(id); }
  enableRule(id: string): void { const r = this.rules.get(id); if (r) r.enabled = true; }
  disableRule(id: string): void { const r = this.rules.get(id); if (r) r.enabled = false; }
  getRules(): readonly AutomationRule[] { return Array.from(this.rules.values()); }
  getLog(): readonly RuleExecution[] { return this.log; }

  private async _eval(event: BusEvent): Promise<void> {
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (!rule.triggerTypes.includes(event.type)) continue;
      if (rule.condition && !rule.condition(event)) continue;
      if (this._isLimited(rule)) { this._record(rule.id, event.id, "rate_limited"); continue; }
      const t = performance.now();
      try { await rule.action(event, rule.id); this._record(rule.id, event.id, "success", performance.now() - t); }
      catch (err) { this._record(rule.id, event.id, "error", performance.now() - t, String(err)); }
    }
  }

  private _isLimited(rule: AutomationRule): boolean {
    const max = rule.maxExecutionsPerMinute ?? 10;
    const now = Date.now();
    const ts = (this.counts.get(rule.id) ?? []).filter((t) => now - t < 60_000);
    this.counts.set(rule.id, ts);
    return ts.length >= max;
  }

  private _record(ruleId: string, eventId: string, outcome: RuleExecution["outcome"], durationMs?: number, error?: string): void {
    this.log.push({ ruleId, eventId, timestamp: Date.now(), outcome, durationMs, error });
    if (this.log.length > 500) this.log.shift();
    if (outcome !== "rate_limited") { const ts = this.counts.get(ruleId) ?? []; ts.push(Date.now()); this.counts.set(ruleId, ts); }
    telemetry.log("STORE", "AUTOMATION_EXEC", { ruleId, eventId, outcome, durationMs, error });
  }
}

export const automationEngine = new AutomationEngine();
