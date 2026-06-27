/**
 * Mirror of the Premon /v1/analyze response shape (Monad / EVM build).
 * Source of truth: apps/server/src/domain/decision.ts
 *
 * Kept SDK-free (no ethers) so wallet UIs and agents can consume it directly.
 */

export type MonadNetwork = "testnet" | "mainnet";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type RiskFindingCode =
  | "SIMULATION_FAILED"
  | "SIMULATION_ERROR"
  | "LOW_CONFIDENCE_INCOMPLETE_DATA"
  | "RISKY_CONTRACT_INTERACTION"
  | "UNKNOWN_CONTRACT_EXPOSURE"
  | "KNOWN_MALICIOUS_ADDRESS"
  | "SUSPICIOUS_CONTRACT_AGE"
  | "ERC20_APPROVAL_GRANTED"
  | "ERC20_APPROVAL_UNLIMITED"
  | "SET_APPROVAL_FOR_ALL"
  | "PERMIT_SIGNATURE_DETECTED"
  | "OWNERSHIP_TRANSFER_DETECTED"
  | "SELFDESTRUCT_DETECTED"
  | "DELEGATECALL_DETECTED"
  | "NATIVE_TRANSFER_TO_CONTRACT"
  | "POST_BALANCE_TOO_LOW"
  | "ESTIMATED_LOSS_EXCEEDS_MAX"
  | "LOSS_PERCENT_UNAVAILABLE"
  | "DEEP_CALL_NESTING"
  | "HIGH_CALL_COUNT"
  | "EXCESSIVE_GAS_FEE"
  | "EXCESSIVE_GAS_PRICE"
  | "X402_SHAPE_INVALID"
  | "X402_MEMO_MISSING"
  | "X402_DESTINATION_MISMATCH"
  | "X402_ASSET_MISMATCH"
  | "X402_AMOUNT_MISMATCH"
  | "X402_FACILITATOR_MISMATCH"
  | "X402_NON_CANONICAL_ASSET"
  // Forward compatibility for future server codes.
  | (string & {});

export interface RiskFinding {
  code: RiskFindingCode;
  severity: RiskSeverity;
  message: string;
  details?: Record<string, unknown>;
}

/** Native MON balance change per address; wei strings preserve precision. */
export interface NativeBalanceChange {
  accountId: string;
  preWei: string | null;
  postWei: string | null;
  deltaWei: string | null;
}

/** ERC-20 token balance change per address. */
export interface AssetBalanceChange {
  accountId: string;
  asset: string;
  assetCode: string;
  assetIssuer: string | null;
  preBalance: string;
  postBalance: string;
  delta: string;
  decimals: number;
}

/** ERC-20 / NFT approval grant. */
export interface ApprovalChange {
  kind: "erc20_approval" | "approval_for_all";
  tokenAddress: string;
  tokenSymbol: string;
  owner: string;
  spender: string;
  amount: string;
  unlimited: boolean;
  message: string;
}

export interface EstimatedChanges {
  native: NativeBalanceChange[];
  assets: AssetBalanceChange[];
  approvals: ApprovalChange[];
}

export interface DecisionMeta {
  analysisVersion: string;
  network: MonadNetwork;
  chainId: number;
  simulatedAt: string;
  confidence: "low" | "medium" | "high";
  integratorRequestId?: string;
}

export interface AnalysisResult {
  safe: boolean;
  reasons: string[];
  estimatedChanges: EstimatedChanges;
  riskFindings: RiskFinding[];
  simulationWarnings: string[];
  meta?: DecisionMeta;
  annotation?: unknown;
  suggestions?: unknown;
}

/** An unsigned/partial EVM tx request, or a raw 0x-hex serialized tx. */
export type TransactionInput =
  | string
  | {
      from?: string;
      to?: string | null;
      value?: string;
      data?: string;
      gas?: string;
      gasLimit?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      gasPrice?: string;
      nonce?: string | number;
      chainId?: string | number;
      type?: string | number;
    };

/** Highest severity present in a list of findings, or null if empty. */
export function maxSeverity(findings: RiskFinding[]): RiskSeverity | null {
  const order: RiskSeverity[] = ["low", "medium", "high", "critical"];
  let topIdx = -1;
  for (const f of findings) {
    const idx = order.indexOf(f.severity);
    if (idx > topIdx) topIdx = idx;
  }
  return topIdx === -1 ? null : order[topIdx]!;
}
