// packages/infrastructure/src/auth/observability/sessionFingerprint.ts
// ─────────────────────────────────────────────────────────────────────────────
// Session Fingerprint — creates and verifies a stable session identity hash.
//
// A session fingerprint is computed from:
//   - IP address (or IP prefix /24 for dynamic IPs)
//   - User-Agent string (browser + OS, normalised)
//   - TLS cipher suite (if available)
//   - Accept-Language header
//
// On every request the fingerprint is re-computed and compared against the
// one stored at session creation. A significant mismatch is flagged as a
// potential session hijack.
//
// Risk scoring:
//   IP changed to different /24  → HIGH risk
//   User-Agent major version diff → MEDIUM risk
//   Accept-Language changed        → LOW risk (can change legitimately)
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";

export interface FingerprintComponents {
  ipPrefix:         string;   // /24 prefix, e.g. "192.168.1"
  userAgentHash:    string;   // SHA-256 of normalised UA
  acceptLanguage:   string;   // first 2 chars, e.g. "en"
}

export interface FingerprintMismatch {
  component:  "ip" | "user_agent" | "accept_language";
  expected:   string;
  actual:     string;
  riskLevel:  "LOW" | "MEDIUM" | "HIGH";
}

export interface FingerprintResult {
  fingerprint: string;
  components:  FingerprintComponents;
}

// ============================================================================
// Compute fingerprint from request headers
// ============================================================================

export function computeFingerprint(params: {
  ip?:             string;
  userAgent?:      string;
  acceptLanguage?: string;
}): FingerprintResult {
  const components = extractComponents(params);
  const raw        = `${components.ipPrefix}|${components.userAgentHash}|${components.acceptLanguage}`;
  const fingerprint = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
  return { fingerprint, components };
}

// ============================================================================
// Verify a fingerprint against stored components
// ============================================================================

export function verifyFingerprint(
  stored: FingerprintComponents,
  current: FingerprintComponents,
): FingerprintMismatch[] {
  const mismatches: FingerprintMismatch[] = [];

  if (stored.ipPrefix !== current.ipPrefix) {
    mismatches.push({
      component: "ip", expected: stored.ipPrefix, actual: current.ipPrefix,
      riskLevel: "HIGH",
    });
  }

  if (stored.userAgentHash !== current.userAgentHash) {
    mismatches.push({
      component: "user_agent", expected: stored.userAgentHash, actual: current.userAgentHash,
      riskLevel: "MEDIUM",
    });
  }

  if (stored.acceptLanguage !== current.acceptLanguage) {
    mismatches.push({
      component: "accept_language", expected: stored.acceptLanguage, actual: current.acceptLanguage,
      riskLevel: "LOW",
    });
  }

  return mismatches;
}

// ============================================================================
// Helpers
// ============================================================================

function extractComponents(params: {
  ip?:             string;
  userAgent?:      string;
  acceptLanguage?: string;
}): FingerprintComponents {
  // IP: take /24 prefix (xxx.xxx.xxx) to tolerate DHCP churn within a network
  const ipPrefix = extractIpPrefix(params.ip ?? "");

  // User-Agent: hash the full UA but normalise whitespace
  const ua = (params.userAgent ?? "").replace(/\s+/g, " ").trim();
  const userAgentHash = crypto.createHash("sha256").update(ua).digest("hex").slice(0, 16);

  // Accept-Language: take first language tag only (e.g. "en-US,en;q=0.9" → "en")
  const acceptLanguage = (params.acceptLanguage ?? "").split(",")[0]?.split("-")[0]?.toLowerCase() ?? "";

  return { ipPrefix, userAgentHash, acceptLanguage };
}

function extractIpPrefix(ip: string): string {
  if (ip.includes(":")) {
    // IPv6: take first 4 groups
    return ip.split(":").slice(0, 4).join(":");
  }
  // IPv4: take first 3 octets (/24)
  return ip.split(".").slice(0, 3).join(".");
}
