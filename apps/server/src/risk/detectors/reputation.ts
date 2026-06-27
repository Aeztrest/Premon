import type { RiskFinding } from "../../domain/findings.js";
import { getReputationDb } from "../../data/reputation-db.js";

/**
 * Reputation-based detector — checks every address the tx references against the
 * reputation DB. Chain-agnostic code path; the EVM build's DB carries 0x
 * entries (drainers, phishing spenders, sanctioned addresses).
 */
export function detectReputationFindings(addresses: string[]): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const db = getReputationDb();
  const distinct = [...new Set(addresses)];
  const hits = db.lookupMany(distinct);

  for (const [address, entry] of hits) {
    findings.push({
      code: "KNOWN_MALICIOUS_ADDRESS",
      severity: entry.severity,
      message: `Address ${address} is flagged: ${entry.label} (${entry.category})`,
      details: {
        address,
        label: entry.label,
        category: entry.category,
        source: entry.source,
      },
    });
  }

  return findings;
}
