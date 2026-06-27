/**
 * EVM internal-call tree. Each node = one message call (CALL / DELEGATECALL /
 * STATICCALL / CREATE / SELFDESTRUCT) the transaction makes. The root is the
 * top-level call from the sender; children are the sub-calls each contract
 * makes — the EVM analogue of Stellar's Soroban auth/CPI tree.
 *
 * Field names are kept generic (`CallNode` / `CallTrace`) so downstream
 * detectors reason about depth and breadth without knowing it's EVM.
 */
export type CallNode = {
  /** CALL | DELEGATECALL | STATICCALL | CREATE | CREATE2 | SELFDESTRUCT */
  callType: string;
  /** Caller address for this frame (0x…). */
  from: string;
  /** Callee / created contract address (0x…); null for some CREATE frames. */
  to: string | null;
  /** 4-byte selector of the input, when present. */
  selector: string | null;
  /** Wei value moved by this frame (decimal string). */
  value: string;
  /** Depth in the call tree (0 = root). */
  depth: number;
  /** Whether this frame reverted. */
  reverted: boolean;
  children: CallNode[];
};

export type CallTrace = {
  roots: CallNode[];
  /** All distinct contract addresses anywhere in the tree. */
  allContractAddresses: string[];
  /** Deepest sub-call level encountered. */
  maxDepth: number;
  /** Total number of frames (root + descendants). */
  totalInvocations: number;
  /** True if any DELEGATECALL frame appears in the tree. */
  hasDelegateCall: boolean;
  /** True if any SELFDESTRUCT frame appears in the tree. */
  hasSelfdestruct: boolean;
};

export const EMPTY_CALL_TRACE: CallTrace = {
  roots: [],
  allContractAddresses: [],
  maxDepth: 0,
  totalInvocations: 0,
  hasDelegateCall: false,
  hasSelfdestruct: false,
};
