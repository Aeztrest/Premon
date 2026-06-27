import type { AppConfig } from "../../config/index.js";
import type { CallTrace } from "../../domain/call-trace.js";
import type { RiskFinding } from "../../domain/findings.js";

const DEEP_NESTING_THRESHOLD = 5;
const HIGH_INVOCATION_THRESHOLD = 20;

/**
 * Inspects the EVM internal-call tree for shape-based red flags: deep call
 * chains (gas-amplification / reentrancy surface) and unusually broad
 * cross-contract exposure. The EVM analogue of the Stellar Soroban auth-tree
 * detector — same thresholds, same finding codes (renamed for EVM).
 */
export function detectCallTraceFindings(
  callTrace: CallTrace,
  _config: AppConfig,
): RiskFinding[] {
  const findings: RiskFinding[] = [];
  if (callTrace.maxDepth >= DEEP_NESTING_THRESHOLD) {
    findings.push({
      code: "DEEP_CALL_NESTING",
      severity: "medium",
      message: `Internal-call tree depth ${callTrace.maxDepth} ≥ ${DEEP_NESTING_THRESHOLD}.`,
      details: { maxDepth: callTrace.maxDepth },
    });
  }
  if (callTrace.totalInvocations >= HIGH_INVOCATION_THRESHOLD) {
    findings.push({
      code: "HIGH_CALL_COUNT",
      severity: "medium",
      message: `Transaction makes ${callTrace.totalInvocations} internal calls.`,
      details: { totalInvocations: callTrace.totalInvocations },
    });
  }
  return findings;
}
