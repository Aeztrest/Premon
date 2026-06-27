import type { AppConfig } from "../config/index.js";
import type { EstimatedChanges } from "../domain/estimated-changes.js";
import type { RiskFinding } from "../domain/findings.js";
import type { NormalizedSimulation } from "../domain/simulation-normalized.js";
import type { PaymentRequirements, Policy } from "../domain/policy.js";
import type { CallTrace } from "../domain/call-trace.js";
import type { TransactionSummary } from "../domain/instruction-summary.js";
import type { DecodedEvmTx } from "../simulation/tx-decode.js";
import type { TxAddressSet } from "../simulation/account-keys.js";
import { detectApprovalFindings, detectIncompleteDataFinding } from "./detectors/approvals.js";
import { detectContractFindings } from "./detectors/programs.js";
import { detectSimulationFindings } from "./detectors/simulation.js";
import { detectCallTraceFindings } from "./detectors/cpi.js";
import { detectReputationFindings } from "./detectors/reputation.js";
import { detectResourceFindings } from "./detectors/compute.js";
import { detectEvmDangerFindings } from "./detectors/evm-danger.js";
import { detectX402Findings } from "./detectors/x402.js";

export type RiskDetectionInput = {
  config: AppConfig;
  policy: Policy;
  simulation: NormalizedSimulation;
  addressSet: TxAddressSet;
  /** Addresses confirmed to have bytecode (resolved from the pre-state). */
  contractAddresses: string[];
  estimatedChanges: EstimatedChanges;
  truncatedAccounts: boolean;
  userWallet: string | null;
  callTrace: CallTrace;
  summary: TransactionSummary;
  tx: DecodedEvmTx;
  paymentRequirements?: PaymentRequirements;
};

/**
 * Fans the tx out through every detector. Order is significant only insofar as
 * "simulation failed / not traced" should surface first so downstream confidence
 * is computed consistently.
 */
export function runRiskDetection(input: RiskDetectionInput): RiskFinding[] {
  const {
    config,
    policy,
    simulation,
    addressSet,
    contractAddresses,
    estimatedChanges,
    truncatedAccounts,
    userWallet,
    callTrace,
    summary,
    tx,
    paymentRequirements,
  } = input;

  const findings: RiskFinding[] = [];

  findings.push(...detectSimulationFindings(simulation));
  findings.push(...detectContractFindings({ contractAddresses, config }));
  findings.push(...detectCallTraceFindings(callTrace, config));
  findings.push(...detectReputationFindings(addressSet.addresses));
  findings.push(...detectResourceFindings(simulation, policy));
  findings.push(...detectApprovalFindings(estimatedChanges));
  findings.push(
    ...detectEvmDangerFindings({
      tx,
      summary,
      callTrace,
      accounts: simulation.accounts,
    }),
  );
  findings.push(...detectX402Findings({ addressSet, policy, paymentRequirements }));

  const needsWalletForPolicy =
    policy.minPostUsdcBalance != null || policy.maxLossPercent != null;
  const userWalletMissingForBalanceRules = needsWalletForPolicy && userWallet == null;

  const incomplete = detectIncompleteDataFinding({
    truncatedAccounts,
    userWalletMissingForBalanceRules,
  });
  if (incomplete) findings.push(incomplete);

  return findings;
}
