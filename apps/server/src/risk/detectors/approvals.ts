import type { EstimatedChanges } from "../../domain/estimated-changes.js";
import type { RiskFinding } from "../../domain/findings.js";

/**
 * Surfaces ERC-20 / ERC-721 / ERC-1155 approval grants as risk findings. This
 * is the EVM rewrite of the Stellar trustline + Soroban-allowance detector —
 * the single most important EVM wallet-drain surface. The policy engine turns
 * these codes into blocks based on the active user policy.
 */
export function detectApprovalFindings(changes: EstimatedChanges): RiskFinding[] {
  const findings: RiskFinding[] = [];

  for (const ap of changes.approvals) {
    if (ap.kind === "approval_for_all") {
      // Only a *grant* (approved=true) is dangerous; a revoke is protective.
      if (ap.unlimited) {
        findings.push({
          code: "SET_APPROVAL_FOR_ALL",
          severity: "high",
          message: ap.message,
          details: {
            collection: ap.tokenAddress,
            operator: ap.spender,
          },
        });
      }
      continue;
    }

    // erc20_approval — a zero-amount approve is a revoke; don't flag it.
    if (ap.amount === "0") continue;

    findings.push({
      code: "ERC20_APPROVAL_GRANTED",
      severity: "medium",
      message: ap.message,
      details: {
        tokenAddress: ap.tokenAddress,
        spender: ap.spender,
        amount: ap.amount,
      },
    });
    if (ap.unlimited) {
      findings.push({
        code: "ERC20_APPROVAL_UNLIMITED",
        severity: "high",
        message: `Approval on ${ap.tokenAddress} to ${ap.spender} is effectively unlimited.`,
        details: { tokenAddress: ap.tokenAddress, spender: ap.spender },
      });
    }
  }

  return findings;
}

export function detectIncompleteDataFinding(input: {
  truncatedAccounts: boolean;
  userWalletMissingForBalanceRules: boolean;
}): RiskFinding | undefined {
  if (!input.truncatedAccounts && !input.userWalletMissingForBalanceRules) {
    return undefined;
  }
  const reasons: string[] = [];
  if (input.truncatedAccounts) reasons.push("address pre-state list truncated for budget");
  if (input.userWalletMissingForBalanceRules) {
    reasons.push("balance-policy rules set but userWallet missing");
  }
  return {
    code: "LOW_CONFIDENCE_INCOMPLETE_DATA",
    severity: "medium",
    message: `Analyzer ran with incomplete inputs: ${reasons.join("; ")}.`,
    details: { reasons },
  };
}
