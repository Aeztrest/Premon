import type { Decision, TransactionSuggestionOutput } from "../domain/decision.js";
import type { NormalizedSimulation } from "../domain/simulation-normalized.js";
import type { TransactionSummary } from "../domain/instruction-summary.js";

export type SuggestionResult = {
  suggestions: TransactionSuggestionOutput[];
};

/**
 * Turns the decision + tx summary into actionable, non-blocking suggestions —
 * the EVM analogue of the Stellar suggestion engine. Suggestions never change
 * the safe/unsafe verdict; they guide the user toward a safer equivalent tx.
 */
export function generateSuggestions(
  decision: Decision,
  simulation: NormalizedSimulation,
  summary: TransactionSummary,
): SuggestionResult {
  const suggestions: TransactionSuggestionOutput[] = [];
  const has = (code: string): boolean =>
    decision.riskFindings.some((f) => f.code === code);

  if (has("ERC20_APPROVAL_UNLIMITED")) {
    suggestions.push({
      id: "limit-approval",
      severity: "warning",
      category: "approval",
      title: "Use a bounded approval",
      description:
        "Replace the unlimited (uint256-max) allowance with the exact amount this interaction needs, so a compromised spender cannot drain the rest of your balance later.",
      autoFixAvailable: true,
    });
  }

  if (has("SET_APPROVAL_FOR_ALL")) {
    suggestions.push({
      id: "avoid-approval-for-all",
      severity: "critical",
      category: "approval",
      title: "Avoid setApprovalForAll",
      description:
        "This grants an operator control over your entire NFT collection. Prefer per-token approvals, and revoke operators you no longer use.",
      autoFixAvailable: false,
    });
  }

  if (has("RISKY_CONTRACT_INTERACTION") || has("KNOWN_MALICIOUS_ADDRESS")) {
    suggestions.push({
      id: "avoid-flagged-address",
      severity: "critical",
      category: "reputation",
      title: "Do not interact with this address",
      description:
        "This transaction references an address flagged as malicious. Cancel unless you are certain this is legitimate.",
      autoFixAvailable: false,
    });
  }

  if (has("EXCESSIVE_GAS_FEE") || has("EXCESSIVE_GAS_PRICE")) {
    suggestions.push({
      id: "lower-gas",
      severity: "warning",
      category: "fees",
      title: "Lower the gas price",
      description:
        "The gas fee on this transaction is unusually high. Re-estimate gas before signing to avoid overpaying.",
      autoFixAvailable: true,
    });
  }

  if (simulation.status === "failed") {
    suggestions.push({
      id: "simulation-failed",
      severity: "critical",
      category: "simulation",
      title: "Transaction is expected to revert",
      description:
        "Simulation shows this transaction reverts. Signing it will waste gas and change nothing on-chain.",
      autoFixAvailable: false,
    });
  }

  if (summary.primaryAction === "native_transfer" && has("NATIVE_TRANSFER_TO_CONTRACT")) {
    suggestions.push({
      id: "native-to-contract",
      severity: "warning",
      category: "transfer",
      title: "Confirm the recipient accepts MON",
      description:
        "You are sending native MON to a contract with no calldata. If the contract has no payable receive function, the funds may be lost.",
      autoFixAvailable: false,
    });
  }

  return { suggestions };
}
