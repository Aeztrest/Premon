import type { NormalizedSimulation } from "../../domain/simulation-normalized.js";
import type { Policy } from "../../domain/policy.js";
import type { RiskFinding } from "../../domain/findings.js";

// Defaults are deliberately generous; Monad gas is cheap. These mostly catch
// wallet auto-bumps gone wild rather than normal activity.
const DEFAULT_HIGH_GAS_FEE_WEI = 100_000_000_000_000_000n; // 0.1 MON total fee
const DEFAULT_HIGH_GAS_PRICE_WEI = 1_000_000_000_000n; // 1000 gwei

/**
 * Flags excessive gas cost. Two surfaces:
 *  - total gas fee (gasLimit/used × effective price) vs an optional policy cap,
 *  - effective gas price vs an optional cap (catches fee-bump griefing).
 * The EVM analogue of the Stellar resource-fee / base-fee detector.
 */
export function detectResourceFindings(
  simulation: NormalizedSimulation,
  policy: Policy,
): RiskFinding[] {
  const findings: RiskFinding[] = [];

  if (simulation.gasFeeWei != null) {
    const fee = safeBig(simulation.gasFeeWei);
    const cap =
      policy.maxGasFeeWei != null
        ? BigInt(Math.round(policy.maxGasFeeWei))
        : DEFAULT_HIGH_GAS_FEE_WEI;
    if (fee > cap) {
      findings.push({
        code: "EXCESSIVE_GAS_FEE",
        severity: policy.maxGasFeeWei != null ? "high" : "medium",
        message: `Estimated gas fee ${fee} wei exceeds cap ${cap} wei.`,
        details: { gasFeeWei: fee.toString(), capWei: cap.toString() },
      });
    }
  }

  if (simulation.gasPriceWei != null) {
    const price = safeBig(simulation.gasPriceWei);
    const cap =
      policy.maxGasPriceWei != null
        ? BigInt(Math.round(policy.maxGasPriceWei))
        : DEFAULT_HIGH_GAS_PRICE_WEI;
    if (price > cap) {
      findings.push({
        code: "EXCESSIVE_GAS_PRICE",
        severity: policy.maxGasPriceWei != null ? "high" : "medium",
        message: `Effective gas price ${price} wei exceeds cap ${cap} wei.`,
        details: { gasPriceWei: price.toString(), capWei: cap.toString() },
      });
    }
  }

  return findings;
}

function safeBig(s: string): bigint {
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}
