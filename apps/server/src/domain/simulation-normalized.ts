/**
 * Per-address state snapshot derived from JSON-RPC (`eth_getBalance`,
 * `eth_getCode`, ERC-20 `balanceOf`). Used both as a "pre" baseline (before
 * simulation) and as a uniform shape downstream detectors can iterate without
 * touching ethers.
 */
export type SimulationAccountState = {
  /** Checksummed 0x address. */
  accountId: string;
  /** False when `eth_getBalance`/`eth_getCode` showed an empty account with no code and no balance. */
  exists: boolean;
  /** Native MON balance, wei as a decimal string. */
  nativeBalance: string;
  /** Whether the address has deployed bytecode (i.e. is a contract). */
  isContract: boolean;
  /** ERC-20 token balances queried for this address. */
  balances: AssetBalance[];
  /** Transaction count (nonce) as a decimal string; null when not fetched. */
  nonce: string | null;
};

/**
 * A single ERC-20 token balance row for an address.
 */
export type AssetBalance = {
  /** Token symbol (e.g. `"USDC"`), or `"native"` for MON. */
  assetCode: string;
  /** Token contract address (0x…); null for native. */
  assetIssuer: string | null;
  /** `"native"` | `"erc20"`. */
  assetType: string;
  /** Balance amount as a decimal string (atomic units, full precision). */
  balance: string;
  /** Token decimals. */
  decimals: number;
};

/**
 * One node in the EVM internal-call tree (from `debug_traceCall` callTracer).
 * This is the EVM analogue of Stellar's Soroban auth tree — depth and breadth
 * feed the same shape-based risk detectors.
 */
export type CallTraceEvent = {
  /** CALL | DELEGATECALL | STATICCALL | CREATE | CREATE2 | SELFDESTRUCT */
  callType: string;
  from: string;
  to: string | null;
  /** Wei value moved by this frame (decimal string). */
  value: string;
  /** 4-byte selector of the call's input, when present. */
  selector: string | null;
  /** Whether this frame reverted. */
  reverted: boolean;
};

type SimulationCommon = {
  /** Internal-call events surfaced by the tracer; empty when no trace available. */
  callEvents: CallTraceEvent[];
  /** Pre-state snapshot of addresses the tx touches. */
  accounts: SimulationAccountState[];
  /** Estimated total gas fee in wei (gasLimit × effectiveGasPrice); null when not derivable. */
  gasFeeWei: string | null;
  /** Estimated gas units used by the call; null when not derivable. */
  gasUsed: string | null;
  /** Effective gas price in wei (maxFeePerGas or gasPrice); null when not present. */
  gasPriceWei: string | null;
  /** Whether the execution was actually traced (vs. inferred from calldata shape). */
  traced: boolean;
};

export type NormalizedSimulation =
  | (SimulationCommon & { status: "success"; err: null })
  | (SimulationCommon & { status: "failed"; err: string });
