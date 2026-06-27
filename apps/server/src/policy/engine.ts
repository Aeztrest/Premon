import type { Policy } from "../domain/policy.js";
import type { Decision, DecisionMeta } from "../domain/decision.js";
import type { EstimatedChanges } from "../domain/estimated-changes.js";
import type { RiskFinding, RiskFindingCode } from "../domain/findings.js";
import type { NormalizedSimulation } from "../domain/simulation-normalized.js";
import type { MonadNetwork } from "../config/index.js";

export type PolicyEvaluationInput = {
  network: MonadNetwork;
  chainId: number;
  policy: Policy;
  simulation: NormalizedSimulation;
  estimatedChanges: EstimatedChanges;
  riskFindings: RiskFinding[];
  simulationWarnings: string[];
  /** Canonical USDC token address for the active network (0x…). */
  usdcAddress: string;
  usdcDecimals: number;
  userWallet: string | null;
  integratorRequestId?: string;
};

function hasCode(findings: RiskFinding[], code: RiskFindingCode): boolean {
  return findings.some((f) => f.code === code);
}

function minAmountRaw(minUi: number, decimals: number): bigint {
  // Convert a UI amount to atomic units without floating drift on the integer part.
  const [intPart, fracPartRaw = ""] = String(minUi).split(".");
  const frac = (fracPartRaw + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(intPart || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

export function evaluatePolicy(input: PolicyEvaluationInput): Decision {
  const {
    network,
    chainId,
    policy,
    simulation,
    estimatedChanges,
    riskFindings,
    simulationWarnings,
    usdcAddress,
    usdcDecimals,
    userWallet,
    integratorRequestId,
  } = input;

  const reasons: string[] = [];
  const infoReasons: string[] = [];
  const extraPolicyFindings: RiskFinding[] = [];

  const requireOkSim = policy.requireSuccessfulSimulation !== false;
  if (simulation.status === "failed") {
    if (requireOkSim) {
      reasons.push("Transaction is expected to revert; blocking under policy");
    } else {
      infoReasons.push(
        "Transaction reverts in simulation, but policy does not require successful simulation — allowed",
      );
    }
  }

  // Contract exposure gates.
  if (policy.blockRiskyContracts && hasCode(riskFindings, "RISKY_CONTRACT_INTERACTION")) {
    reasons.push("Risky contract interaction detected and blocked by policy");
  }
  if (
    policy.blockUnknownContractExposure &&
    hasCode(riskFindings, "UNKNOWN_CONTRACT_EXPOSURE") &&
    policy.allowWarnings !== true
  ) {
    reasons.push("Unknown contract exposure detected and blocked by policy");
  }

  // Approval gates (the EVM drainer surface).
  if (policy.blockApprovals && hasCode(riskFindings, "ERC20_APPROVAL_GRANTED")) {
    reasons.push("ERC-20 approval detected and blocked by policy");
  }
  if (policy.blockUnlimitedApprovals && hasCode(riskFindings, "ERC20_APPROVAL_UNLIMITED")) {
    reasons.push("Unlimited ERC-20 approval detected and blocked by policy");
  }
  if (policy.blockApprovalForAll && hasCode(riskFindings, "SET_APPROVAL_FOR_ALL")) {
    reasons.push("setApprovalForAll detected and blocked by policy");
  }

  // EVM control-flow gates.
  if (policy.blockSelfdestruct && hasCode(riskFindings, "SELFDESTRUCT_DETECTED")) {
    reasons.push("SELFDESTRUCT detected and blocked by policy");
  }
  if (policy.blockDelegatecall && hasCode(riskFindings, "DELEGATECALL_DETECTED")) {
    reasons.push("DELEGATECALL detected and blocked by policy");
  }
  if (policy.blockOwnershipTransfer && hasCode(riskFindings, "OWNERSHIP_TRANSFER_DETECTED")) {
    reasons.push("Ownership transfer detected and blocked by policy");
  }

  // Max native (MON) loss percent.
  if (policy.maxLossPercent != null) {
    if (!userWallet) {
      reasons.push("Cannot evaluate max loss percent without userWallet context");
      extraPolicyFindings.push({
        code: "LOSS_PERCENT_UNAVAILABLE",
        severity: "high",
        message: "maxLossPercent policy set but userWallet was not provided",
      });
    } else {
      const nativeRow = estimatedChanges.native.find((n) => n.accountId === userWallet);
      const pre = nativeRow?.preWei;
      const delta = nativeRow?.deltaWei;
      if (pre == null || delta == null || BigInt(pre) <= 0n) {
        reasons.push("Cannot estimate loss percent for user wallet (missing pre-state)");
        extraPolicyFindings.push({
          code: "LOSS_PERCENT_UNAVAILABLE",
          severity: "high",
          message: "Insufficient data to compute loss percent (fail-closed)",
        });
      } else {
        const preF = Number(BigInt(pre));
        const deltaF = Number(BigInt(delta));
        const lossPct = Math.max(0, -deltaF / preF) * 100;
        if (lossPct > policy.maxLossPercent + 1e-9) {
          reasons.push(
            `Estimated MON loss ${lossPct.toFixed(4)}% exceeds max allowed ${policy.maxLossPercent}%`,
          );
          extraPolicyFindings.push({
            code: "ESTIMATED_LOSS_EXCEEDS_MAX",
            severity: "high",
            message: "Estimated loss for user wallet exceeds policy threshold",
            details: { lossPercent: lossPct, maxLossPercent: policy.maxLossPercent },
          });
        }
      }
    }
  }

  // Min post-tx token balance.
  if (policy.minPostUsdcBalance != null) {
    const asset = policy.minPostAsset?.trim() || usdcAddress;
    if (!userWallet) {
      reasons.push("Cannot evaluate minimum balance without userWallet context");
      extraPolicyFindings.push({
        code: "POST_BALANCE_TOO_LOW",
        severity: "high",
        message: "minPostUsdcBalance policy set but userWallet was not provided",
      });
    } else {
      const row = estimatedChanges.assets.find(
        (t) => t.asset.toLowerCase() === asset.toLowerCase() && t.accountId === userWallet,
      );
      if (!row) {
        reasons.push(`No projected balance for asset ${asset} on user wallet ${userWallet}`);
        extraPolicyFindings.push({
          code: "POST_BALANCE_TOO_LOW",
          severity: "high",
          message: "Cannot verify post-transaction balance (asset not in simulation set)",
        });
      } else {
        const postRaw = BigInt(row.postBalance);
        const minRaw = minAmountRaw(policy.minPostUsdcBalance, row.decimals || usdcDecimals);
        if (postRaw < minRaw) {
          reasons.push(`Post-transaction balance is below minimum ${policy.minPostUsdcBalance}`);
          extraPolicyFindings.push({
            code: "POST_BALANCE_TOO_LOW",
            severity: "high",
            message: "Estimated post-transaction balance is below policy minimum",
            details: { asset, min: policy.minPostUsdcBalance },
          });
        }
      }
    }
  }

  const mergedFindings = mergeFindings(riskFindings, extraPolicyFindings);
  const blocked = isBlocked({ policy, simulation, mergedFindings, reasons });

  const meta: DecisionMeta = {
    analysisVersion: "v1-evm",
    network,
    chainId,
    simulatedAt: new Date().toISOString(),
    confidence: deriveConfidence(mergedFindings, simulation),
    integratorRequestId,
  };

  return {
    safe: !blocked,
    reasons: dedupeStrings([...reasons, ...infoReasons]),
    estimatedChanges,
    riskFindings: mergedFindings,
    simulationWarnings,
    meta,
  };
}

type BlockInput = {
  policy: Policy;
  simulation: NormalizedSimulation;
  mergedFindings: RiskFinding[];
  reasons: string[];
};

function isBlocked(input: BlockInput): boolean {
  const { policy, simulation, mergedFindings, reasons } = input;
  if (reasons.length > 0) return true;

  // Critical findings (known-malicious address, selfdestruct) always block,
  // independent of policy toggles. This is the security-tool fail-closed default.
  if (mergedFindings.some((f) => f.severity === "critical")) return true;

  const requireOkSim = policy.requireSuccessfulSimulation !== false;
  if (requireOkSim && simulation.status === "failed") return true;

  const gateMap: [keyof Policy, RiskFindingCode[]][] = [
    ["blockRiskyContracts", ["RISKY_CONTRACT_INTERACTION"]],
    ["blockApprovals", ["ERC20_APPROVAL_GRANTED"]],
    ["blockUnlimitedApprovals", ["ERC20_APPROVAL_UNLIMITED"]],
    ["blockApprovalForAll", ["SET_APPROVAL_FOR_ALL"]],
    ["blockSelfdestruct", ["SELFDESTRUCT_DETECTED"]],
    ["blockDelegatecall", ["DELEGATECALL_DETECTED"]],
    ["blockOwnershipTransfer", ["OWNERSHIP_TRANSFER_DETECTED"]],
  ];
  for (const [flag, codes] of gateMap) {
    if (policy[flag] && codes.some((c) => hasCode(mergedFindings, c))) return true;
  }

  if (
    policy.blockUnknownContractExposure &&
    hasCode(mergedFindings, "UNKNOWN_CONTRACT_EXPOSURE") &&
    policy.allowWarnings !== true
  ) {
    return true;
  }

  const policyViolationCodes: RiskFindingCode[] = [
    "LOSS_PERCENT_UNAVAILABLE",
    "ESTIMATED_LOSS_EXCEEDS_MAX",
    "POST_BALANCE_TOO_LOW",
  ];
  for (const c of policyViolationCodes) {
    if (hasCode(mergedFindings, c)) return true;
  }

  if (hasCode(mergedFindings, "LOW_CONFIDENCE_INCOMPLETE_DATA") && policy.allowWarnings !== true) {
    return true;
  }

  return false;
}

function mergeFindings(a: RiskFinding[], b: RiskFinding[]): RiskFinding[] {
  const seen = new Set<string>();
  const out: RiskFinding[] = [];
  for (const f of [...a, ...b]) {
    const k = `${f.code}:${JSON.stringify(f.details ?? {})}:${f.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

function deriveConfidence(
  findings: RiskFinding[],
  simulation: NormalizedSimulation,
): DecisionMeta["confidence"] {
  if (hasCode(findings, "LOW_CONFIDENCE_INCOMPLETE_DATA")) return "low";
  if (simulation.status === "failed") return "low";
  if (!simulation.traced) return "medium";
  return "high";
}

function dedupeStrings(xs: string[]): string[] {
  return [...new Set(xs)];
}
