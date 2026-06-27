import { decodeKnownCall, asAddress, selectorOf } from "./abi.js";
import type { DecodedEvmTx } from "./tx-decode.js";

/**
 * Distinct addresses / call targets / tokens / assets a tx references. The EVM
 * analogue of Stellar's `collectTxAccounts`: instead of walking XDR ops we
 * decode the calldata of the single top-level call to surface the spender /
 * recipient / token addresses hidden inside it.
 *
 * Which of these are *contracts* is resolved later by the simulator via
 * `eth_getCode` — calldata alone cannot tell an EOA from a contract.
 */
export type TxAddressSet = {
  /** Every distinct address referenced (checksummed): from, to, decoded args. */
  addresses: string[];
  /** Addresses called with non-empty calldata (contract-call targets). */
  callTargets: string[];
  /** Token / collection contracts inferred from recognised token/NFT calls. */
  tokens: string[];
  /** Asset identifiers touched: token addresses (0x…) and `native` when value > 0. */
  assets: string[];
};

export function collectTxAddresses(tx: DecodedEvmTx): TxAddressSet {
  const addresses = new Set<string>();
  const callTargets = new Set<string>();
  const tokens = new Set<string>();
  const assets = new Set<string>();

  if (tx.from) addresses.add(tx.from);
  if (tx.to) addresses.add(tx.to);

  const hasData = tx.data != null && tx.data !== "0x";
  if (tx.to && hasData) callTargets.add(tx.to);

  if (tx.value > 0n) assets.add("native");

  const decoded = hasData ? decodeKnownCall(tx.data) : null;
  if (decoded && tx.to) {
    // For all recognised token / NFT primitives, the `to` of the tx is the
    // token (or collection) contract itself.
    const isTokenPrimitive = [
      "transfer",
      "transferFrom",
      "approve",
      "permit",
      "setApprovalForAll",
      "safeTransferFrom",
    ].includes(decoded.name);
    if (isTokenPrimitive) {
      tokens.add(tx.to);
      assets.add(tx.to);
    }

    for (const arg of decoded.args) {
      const a = asAddress(arg);
      if (a) addresses.add(a);
    }
  }

  return {
    addresses: [...addresses],
    callTargets: [...callTargets],
    tokens: [...tokens],
    assets: [...assets],
  };
}

export { selectorOf };
