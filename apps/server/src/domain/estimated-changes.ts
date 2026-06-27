/**
 * Native MON balance change per address. Wei strings preserve full precision
 * (EVM amounts routinely exceed Number.MAX_SAFE_INTEGER). 1 MON = 1e18 wei.
 */
export type NativeBalanceChange = {
  /** Checksummed 0x address. */
  accountId: string;
  preWei: string | null;
  postWei: string | null;
  deltaWei: string | null;
};

/**
 * ERC-20 token balance change per address. Covers any token contract the tx
 * moves value through (direct transfers, transferFrom, router swaps when the
 * trace surfaces them).
 */
export type AssetBalanceChange = {
  /** Checksummed 0x address whose balance changes. */
  accountId: string;
  /** Canonical asset identifier: the ERC-20 contract address (0x…). */
  asset: string;
  /** Token symbol (`"USDC"`, …) or empty string when unknown. */
  assetCode: string;
  /** Token contract address (0x…); same as `asset` for ERC-20. */
  assetIssuer: string | null;
  /** Atomic-unit amounts as decimal strings; preserve full precision. */
  preBalance: string;
  postBalance: string;
  delta: string;
  /** Token decimals (USDC = 6, most ERC-20 = 18). */
  decimals: number;
};

/**
 * An ERC-20 / ERC-721 / ERC-1155 approval the tx grants. This is the EVM
 * counterpart of Stellar's trustline + Soroban-allowance changes combined —
 * the primary "wallet drainer" attack surface on EVM chains.
 */
export type ApprovalChange = {
  kind: "erc20_approval" | "approval_for_all";
  /** Token / collection contract whose approval is being set. */
  tokenAddress: string;
  /** Token symbol when known. */
  tokenSymbol: string;
  /** Address granting the approval (the owner / tx sender). */
  owner: string;
  /** Spender / operator being authorized. */
  spender: string;
  /**
   * Approval amount as an atomic-unit decimal string. For
   * `approval_for_all` this is `"1"` (granted) or `"0"` (revoked).
   */
  amount: string;
  /** True when the amount is the uint256-max sentinel (effectively unlimited). */
  unlimited: boolean;
  message: string;
};

export type EstimatedChanges = {
  native: NativeBalanceChange[];
  assets: AssetBalanceChange[];
  approvals: ApprovalChange[];
};
