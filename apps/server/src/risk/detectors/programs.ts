import type { AppConfig } from "../../config/index.js";
import type { RiskFinding } from "../../domain/findings.js";

/**
 * Detects risky / unknown contracts: contracts the operator flags as risky,
 * plus contracts not on the known-safe allowlist when one is configured.
 * Addresses are compared case-insensitively against the configured sets, which
 * are stored checksummed.
 */
export function detectContractFindings(args: {
  contractAddresses: string[];
  config: AppConfig;
}): RiskFinding[] {
  const { contractAddresses, config } = args;
  const findings: RiskFinding[] = [];

  const risky = lowerSet(config.riskyContractIds);
  const safe = lowerSet(config.knownSafeContractIds);

  for (const c of contractAddresses) {
    if (risky.has(c.toLowerCase())) {
      findings.push({
        code: "RISKY_CONTRACT_INTERACTION",
        severity: "high",
        message: `Transaction touches contract on the risky list: ${c}`,
        details: { contract: c },
      });
    }
  }

  if (safe.size > 0) {
    for (const c of contractAddresses) {
      if (!safe.has(c.toLowerCase())) {
        findings.push({
          code: "UNKNOWN_CONTRACT_EXPOSURE",
          severity: "medium",
          message: `Contract ${c} is not on the configured known-safe list.`,
          details: { contract: c },
        });
      }
    }
  }

  return findings;
}

function lowerSet(s: Set<string>): Set<string> {
  return new Set([...s].map((x) => x.toLowerCase()));
}
