// apps/web/src/infrastructure/observability/alerts.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Threshold-based alert system that monitors metrics and triggers
// notifications when production SLO/SLI boundaries are breached.
// ─────────────────────────────────────────────────────────────────────────────

import { metrics } from "./metrics";
import { logger } from "./logging";

// ============================================================================
// 1.  Types
// ============================================================================

export type AlertSeverity = "warning" | "critical";
export type AlertStatus = "firing" | "resolved";

export interface AlertRule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly severity: AlertSeverity;
  /** Evaluate this rule — returns true when threshold is breached. */
  readonly evaluate: () => boolean;
  /** Cooldown between repeated fires (ms). Default: 60_000. */
  readonly cooldownMs?: number;
}

export interface Alert {
  readonly ruleId: string;
  readonly name: string;
  readonly severity: AlertSeverity;
  readonly status: AlertStatus;
  readonly firedAt: string;
  readonly resolvedAt?: string;
  readonly details?: Record<string, unknown>;
}

export interface AlertsConfig {
  enabled: boolean;
  evaluationIntervalMs: number;
  /** Webhook URL for Slack/PagerDuty/Email. */
  webhookUrl?: string;
  /** Custom notification function for testing. */
  notifyFn?: (alert: Alert) => Promise<void>;
}

const DEFAULT_CONFIG: AlertsConfig = {
  enabled: process.env.NODE_ENV === "production",
  evaluationIntervalMs: 30_000,
};

// ============================================================================
// 2.  AlertManager
// ============================================================================

export class AlertManager {
  private config: AlertsConfig;
  private rules: AlertRule[] = [];
  private activeAlerts = new Map<string, Alert>();
  private lastFired = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<AlertsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  init(): void {
    if (!this.config.enabled) return;
    this.timer = setInterval(() => this.evaluate(), this.config.evaluationIntervalMs);
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  registerRule(rule: AlertRule): void {
    this.rules.push(rule);
  }

  evaluate(): void {
    const now = Date.now();

    for (const rule of this.rules) {
      const cooldown = rule.cooldownMs ?? 60_000;
      const lastFire = this.lastFired.get(rule.id) ?? 0;

      const breached = rule.evaluate();

      if (breached && !this.activeAlerts.has(rule.id)) {
        if (now - lastFire < cooldown) continue;

        const alert: Alert = {
          ruleId: rule.id,
          name: rule.name,
          severity: rule.severity,
          status: "firing",
          firedAt: new Date().toISOString(),
        };

        this.activeAlerts.set(rule.id, alert);
        this.lastFired.set(rule.id, now);
        this._notify(alert);

        logger.warn("alert.fired", rule.id, "fail", {
          name: rule.name,
          severity: rule.severity,
        });
      } else if (!breached && this.activeAlerts.has(rule.id)) {
        const existing = this.activeAlerts.get(rule.id)!;
        const resolved: Alert = {
          ...existing,
          status: "resolved",
          resolvedAt: new Date().toISOString(),
        };
        this.activeAlerts.delete(rule.id);
        this._notify(resolved);

        logger.info("alert.resolved", rule.id, "success", { name: rule.name });
      }
    }
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  private async _notify(alert: Alert): Promise<void> {
    if (this.config.notifyFn) {
      await this.config.notifyFn(alert);
      return;
    }

    if (this.config.webhookUrl) {
      try {
        await fetch(this.config.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(alert),
          keepalive: true,
        });
      } catch { /* best-effort */ }
    }
  }
}

// ============================================================================
// 3.  Singleton + default rules
// ============================================================================

export const alertManager = new AlertManager();

// ── Default production rules ─────────────────────────────────────────────────

alertManager.registerRule({
  id: "replay_gap_spike",
  name: "Replay Gap Spike",
  description: "More than 5 sequence gaps in the last evaluation window.",
  severity: "warning",
  evaluate: () => metrics.counter("replay_gaps_total").value > 5,
});

alertManager.registerRule({
  id: "outbox_stuck",
  name: "Outbox Stuck",
  description: "Pending mutations gauge exceeds 20.",
  severity: "critical",
  evaluate: () => metrics.gauge("outbox_pending_mutations").value > 20,
});

alertManager.registerRule({
  id: "reconnect_storm",
  name: "Reconnect Storm",
  description: "More than 10 reconnects in the evaluation window.",
  severity: "critical",
  evaluate: () => metrics.counter("ws_reconnects_total").value > 10,
});

alertManager.registerRule({
  id: "reducer_crash_rate",
  name: "Reducer Crash Rate High",
  description: "More than 3 reducer crashes detected.",
  severity: "critical",
  evaluate: () => metrics.counter("reducer_crashes_total").value > 3,
});

alertManager.registerRule({
  id: "dlq_growth",
  name: "DLQ Growth",
  description: "Dead Letter Queue has items — requires manual intervention.",
  severity: "warning",
  evaluate: () => metrics.counter("outbox_dlq_total").value > 0,
});
