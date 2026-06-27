/**
 * Pooled ethers JsonRpcProvider per network. Reused across handlers, monitor,
 * and reconciliation so we don't open redundant connections.
 */

import { JsonRpcProvider, Network } from "ethers";
import type { MonadNetwork } from "@premon/ext-protocol";
import { chainFor } from "../../shared/chain";
import { getState } from "../state/store";

const providerCache = new Map<MonadNetwork, JsonRpcProvider>();

export function getProvider(network?: MonadNetwork): JsonRpcProvider {
  const n: MonadNetwork = network ?? getState().network;
  let provider = providerCache.get(n);
  if (!provider) {
    const cfg = chainFor(n);
    // Pin the chain id + name so ethers never performs an eth_chainId probe
    // that would fail to auto-detect on a fresh service-worker wake.
    const net = new Network(`monad-${n}`, cfg.chainId);
    provider = new JsonRpcProvider(cfg.rpcUrl, net, {
      staticNetwork: net,
      batchMaxCount: 1,
    });
    providerCache.set(n, provider);
  }
  return provider;
}

export function getChainId(network?: MonadNetwork): number {
  const n: MonadNetwork = network ?? getState().network;
  return chainFor(n).chainId;
}
