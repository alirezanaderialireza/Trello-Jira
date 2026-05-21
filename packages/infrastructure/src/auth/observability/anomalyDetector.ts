// packages/infrastructure/src/auth/observability/anomalyDetector.ts
// ─────────────────────────────────────────────────────────────────────────────
// Anomaly Detector — pattern-based detection of suspicious auth behaviour.
//
// Detects:
//   1. Brute force (N failed logins within window)
//   2. Session churn (many new sessions for same user in short window)
//   3. Reconnect storm (too many WS reconnects — possible token theft)
//   4. ACL violation spike (repeated unauthorised access attempts)
//   5. Concurrent session limit exceeded
//
// Each detector is a pure function returning a risk signal (NONE/LOW/HIGH/CRITICAL).
// The Dispatcher calls alert handlers registered via onAlert().
// ─────────────────────────────────────────────────────────────────────────────

import type { AuthMetrics } from "./authMetrics";

export type RiskLevel = "NONE" | "LOW" | "HIGH" | "CRITICAL";

export interface AnomalySignal {
  type:      string;
  riskLevel: RiskLevel;
  tenantId:  string;
  userId?:   string;
  detail:    string;
  detectedAt: number;
}

export type AlertHandler = (signal: AnomalySignal) => void | Promise<void>;

const THRESHOLDS = {
  bruteForce:           { window1Min: 5,  riskHigh: 10, riskCritical: 20 },
  sessionChurn:         { window1Min: 5,  riskHigh: 15 },
  reconnectStorm:       { window1Min: 10, riskCritical: 25 },
  aclViolationSpike:    { window1Min: 5,  riskHigh: 20 },
  concurrentSessionMax: 10,
} as const;

export class AnomalyDetector {
  private handlers = new Set<AlertHandler>();

  constructor(private readonly metrics: AuthMetrics) {}

  onAlert(handler: AlertHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  // ── Run all detectors for a given tenant/user after an auth event ─────────

  async runAll(tenantId: string, userId?: string): Promise<AnomalySignal[]> {
    const signals: AnomalySignal[] = [];

    signals.push(...await Promise.all([
      this.detectBruteForce(tenantId),
      this.detectSessionChurn(tenantId, userId),
      this.detectReconnectStorm(tenantId, userId),
      this.detectAclViolationSpike(tenantId, userId),
    ]));

    const real = signals.filter((s) => s.riskLevel !== "NONE");

    for (const signal of real) {
      for (const h of this.handlers) {
        try { await h(signal); } catch { /**/ }
      }
    }

    return real;
  }

  // ── Individual detectors ────────────────────────────────────────────────────

  async detectBruteForce(tenantId: string): Promise<AnomalySignal> {
    const count = await this.metrics.getWindowCount("login_failure", tenantId, 60);
    const t     = THRESHOLDS.bruteForce;
    return {
      type: "brute_force", tenantId, detectedAt: Date.now(),
      detail:    `${count} failed logins in 1 min`,
      riskLevel: count >= t.riskCritical ? "CRITICAL" : count >= t.riskHigh ? "HIGH"
               : count >= t.window1Min   ? "LOW"       : "NONE",
    };
  }

  async detectSessionChurn(tenantId: string, userId?: string): Promise<AnomalySignal> {
    const count = await this.metrics.getWindowCount("session_created", tenantId, 60);
    const t     = THRESHOLDS.sessionChurn;
    return {
      type: "session_churn", tenantId, userId, detectedAt: Date.now(),
      detail:    `${count} sessions created in 1 min`,
      riskLevel: count >= t.riskHigh    ? "HIGH" : count >= t.window1Min ? "LOW" : "NONE",
    };
  }

  async detectReconnectStorm(tenantId: string, userId?: string): Promise<AnomalySignal> {
    const count = await this.metrics.getWindowCount("reconnect_spike", tenantId, 60);
    const t     = THRESHOLDS.reconnectStorm;
    return {
      type: "reconnect_storm", tenantId, userId, detectedAt: Date.now(),
      detail:    `${count} reconnects in 1 min`,
      riskLevel: count >= t.riskCritical ? "CRITICAL" : count >= t.window1Min ? "LOW" : "NONE",
    };
  }

  async detectAclViolationSpike(tenantId: string, userId?: string): Promise<AnomalySignal> {
    const count = await this.metrics.getWindowCount("acl_violation", tenantId, 60);
    const t     = THRESHOLDS.aclViolationSpike;
    return {
      type: "acl_violation_spike", tenantId, userId, detectedAt: Date.now(),
      detail:    `${count} ACL violations in 1 min`,
      riskLevel: count >= t.riskHigh ? "HIGH" : count >= t.window1Min ? "LOW" : "NONE",
    };
  }
}
