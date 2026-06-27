export type RiskSeverity = "low" | "medium" | "high" | "critical";

/**
 * EVM / Monad risk taxonomy. This is the chain-native rewrite of the Stellar
 * finding set: Soroban-allowance / trustline / account-merge codes are replaced
 * by their EVM equivalents (ERC-20 approvals, setApprovalForAll, selfdestruct,
 * delegatecall, ownership transfer), while the chain-agnostic codes
 * (simulation, reputation, contract exposure, loss, gas, x402) are preserved.
 */
export type RiskFindingCode =
  // Simulation / pipeline state
  | "SIMULATION_FAILED"
  | "SIMULATION_ERROR"
  | "LOW_CONFIDENCE_INCOMPLETE_DATA"
  // Contract reputation / exposure
  | "RISKY_CONTRACT_INTERACTION"
  | "UNKNOWN_CONTRACT_EXPOSURE"
  | "KNOWN_MALICIOUS_ADDRESS"
  | "SUSPICIOUS_CONTRACT_AGE"
  // ERC-20 / ERC-721 / ERC-1155 approval danger (the EVM drainer surface)
  | "ERC20_APPROVAL_GRANTED"
  | "ERC20_APPROVAL_UNLIMITED"
  | "SET_APPROVAL_FOR_ALL"
  | "PERMIT_SIGNATURE_DETECTED"
  // EVM account / contract control danger
  | "OWNERSHIP_TRANSFER_DETECTED"
  | "SELFDESTRUCT_DETECTED"
  | "DELEGATECALL_DETECTED"
  | "NATIVE_TRANSFER_TO_CONTRACT"
  // Balance & loss
  | "POST_BALANCE_TOO_LOW"
  | "ESTIMATED_LOSS_EXCEEDS_MAX"
  | "LOSS_PERCENT_UNAVAILABLE"
  // Internal-call (CPI analogue) shape
  | "DEEP_CALL_NESTING"
  | "HIGH_CALL_COUNT"
  // Gas / fee
  | "EXCESSIVE_GAS_FEE"
  | "EXCESSIVE_GAS_PRICE"
  // x402 protocol-specific
  | "X402_SHAPE_INVALID"
  | "X402_MEMO_MISSING"
  | "X402_DESTINATION_MISMATCH"
  | "X402_ASSET_MISMATCH"
  | "X402_AMOUNT_MISMATCH"
  | "X402_FACILITATOR_MISMATCH"
  | "X402_NON_CANONICAL_ASSET";

export type RiskFinding = {
  code: RiskFindingCode;
  severity: RiskSeverity;
  message: string;
  details?: Record<string, unknown>;
};
