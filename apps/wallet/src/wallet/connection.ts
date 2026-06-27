/**
 * Monad (EVM) JSON-RPC client + chain config for the wallet (testnet build).
 * The wallet talks to a single network; production deployments can switch
 * ACTIVE_NETWORK to "mainnet" once Monad mainnet is live.
 */

import { ethers } from "ethers";
import type { MonadNetwork } from "@premon/guard";

export const ACTIVE_NETWORK: MonadNetwork = "testnet";

export interface ChainConfig {
  network: MonadNetwork;
  chainId: number;
  rpcUrl: string;
  name: string;
  nativeSymbol: string;
  nativeDecimals: number;
  explorerBase: string;
}

export const MONAD_TESTNET: ChainConfig = {
  network: "testnet",
  chainId: 10143,
  rpcUrl: "https://testnet-rpc.monad.xyz",
  name: "Monad Testnet",
  nativeSymbol: "MON",
  nativeDecimals: 18,
  explorerBase: "https://testnet.monadexplorer.com",
};

const CHAINS: Record<MonadNetwork, ChainConfig> = {
  testnet: MONAD_TESTNET,
  // Mainnet is not live yet — point at testnet so the app still resolves.
  mainnet: MONAD_TESTNET,
};

export const CHAIN = CHAINS[ACTIVE_NETWORK];
export const RPC_URL = CHAIN.rpcUrl;
export const CHAIN_ID = CHAIN.chainId;
export const NATIVE_SYMBOL = CHAIN.nativeSymbol;

/**
 * There is no programmatic Monad faucet. Point users at the public faucet and
 * let them copy their address to fund it manually.
 */
export const FAUCET_URL = "https://faucet.monad.xyz";

/** Configurable USDC token on Monad testnet (6 decimals). */
export const USDC_TOKEN =
  (import.meta.env.VITE_USDC_ADDRESS as string | undefined) ??
  "0xf817257fed379853cDe0fa4F97AB987181B1E5Ea";
export const USDC_DECIMALS = 6;

let provider: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (!provider) provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  return provider;
}

/** monadexplorer.com deep link for an address or transaction. */
export function explorerUrl(kind: "account" | "address" | "tx", value: string): string {
  const seg = kind === "tx" ? "tx" : "address";
  return `${CHAIN.explorerBase}/${seg}/${value}`;
}
