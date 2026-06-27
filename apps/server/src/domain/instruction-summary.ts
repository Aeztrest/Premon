/**
 * EVM operation taxonomy — the chain-native rewrite of the Stellar operation
 * set. An EVM transaction is a single top-level call, so the "operation" is
 * the decoded intent of the calldata (ERC-20 transfer/approve, NFT operator
 * approval, native transfer, contract deploy, arbitrary contract call).
 */
export type OperationAction =
  | "native_transfer"
  | "contract_deploy"
  | "contract_call"
  | "erc20_transfer"
  | "erc20_transfer_from"
  | "erc20_approve"
  | "erc20_permit"
  | "nft_transfer"
  | "nft_set_approval_for_all"
  | "ownership_transfer"
  | "swap"
  | "selfdestruct"
  | "unknown";

export type DecodedOperation = {
  /** Position of the operation (always 0 for a single-call EVM tx; >0 for multicall sub-ops). */
  index: number;
  /** Decoded function name (`"approve"`, `"transfer"`, …) or `"<raw>"`. */
  type: string;
  /** Operation source override; null = tx sender. */
  source: string | null;
  action: OperationAction;
  description: string;
  details?: Record<string, unknown>;
};

export type TransactionSummary = {
  operations: DecodedOperation[];
  /** Single-line human-readable verdict (e.g. "Approve unlimited USDC to 0x…"). */
  humanReadable: string;
  primaryAction: OperationAction;
  /** Contract addresses (0x…) touched anywhere in the tx. */
  involvedContracts: string[];
  /** Asset identifiers touched: token addresses (0x…) / `native`. */
  involvedAssets: string[];
};
