import type { CallTrace } from "../../domain/call-trace.js";
import type { RiskFinding } from "../../domain/findings.js";
import type { SimulationAccountState } from "../../domain/simulation-normalized.js";
import type { TransactionSummary } from "../../domain/instruction-summary.js";
import type { DecodedEvmTx } from "../../simulation/tx-decode.js";

/**
 * EVM-native control-flow / privilege danger detector. These are the codes that
 * have no Stellar analogue — they replace Stellar's account-merge / signer /
 * master-key detectors with the EVM equivalents that actually drain or seize
 * control of EVM wallets and contracts.
 */
export function detectEvmDangerFindings(input: {
  tx: DecodedEvmTx;
  summary: TransactionSummary;
  callTrace: CallTrace;
  accounts: SimulationAccountState[];
}): RiskFinding[] {
  const { tx, summary, callTrace, accounts } = input;
  const findings: RiskFinding[] = [];

  if (callTrace.hasSelfdestruct) {
    findings.push({
      code: "SELFDESTRUCT_DETECTED",
      severity: "critical",
      message: "Transaction trace contains a SELFDESTRUCT — a contract is being destroyed.",
    });
  }

  if (callTrace.hasDelegateCall) {
    findings.push({
      code: "DELEGATECALL_DETECTED",
      severity: "medium",
      message:
        "Transaction trace contains a DELEGATECALL — the target executes code in the caller's storage context.",
    });
  }

  if (summary.primaryAction === "ownership_transfer") {
    const newOwner = summary.operations[0]?.details?.newOwner;
    findings.push({
      code: "OWNERSHIP_TRANSFER_DETECTED",
      severity: "high",
      message: "Transaction transfers ownership of a contract.",
      details: newOwner ? { newOwner } : undefined,
    });
  }

  if (summary.primaryAction === "erc20_permit") {
    findings.push({
      code: "PERMIT_SIGNATURE_DETECTED",
      severity: "medium",
      message:
        "Transaction submits an EIP-2612 permit — an off-chain signed approval is being applied on-chain.",
    });
  }

  // Native MON sent to a contract with no calldata: a common loss-of-funds
  // footgun (the contract may not have a payable receive function).
  if (tx.value > 0n && tx.to && tx.data === "0x") {
    const toState = accounts.find((a) => a.accountId === tx.to);
    if (toState?.isContract) {
      findings.push({
        code: "NATIVE_TRANSFER_TO_CONTRACT",
        severity: "low",
        message: `Sending native MON to contract ${tx.to} with no calldata.`,
        details: { to: tx.to, amountWei: tx.value.toString() },
      });
    }
  }

  return findings;
}
