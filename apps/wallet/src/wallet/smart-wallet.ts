/**
 * "Smart wallet" module (Monad / EVM build).
 *
 * On EVM the EOA *is* the wallet — there is no per-user smart-wallet contract to
 * deploy or provision (unlike the Stellar Soroban build). This thin module
 * exists only so the rest of the app keeps a consistent shape: it resolves the
 * wallet address (the EOA) and reads on-chain balances.
 */

import { ethers } from "ethers";

/** The EOA address is the wallet address — nothing to provision. */
export function resolveWalletAddress(address: string): string {
  return address;
}

/** Native MON balance for an address (in MON), or null on RPC failure. */
export async function fetchNativeBalance(
  provider: ethers.Provider,
  address: string,
): Promise<number | null> {
  try {
    const wei = await provider.getBalance(address);
    return Number(ethers.formatEther(wei));
  } catch {
    return null;
  }
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export interface TokenBalance {
  amount: number;
  symbol: string;
  decimals: number;
}

/** Read an ERC-20 balance (e.g. USDC) for an address, or null on failure. */
export async function fetchTokenBalance(
  provider: ethers.Provider,
  token: string,
  address: string,
): Promise<TokenBalance | null> {
  try {
    const c = new ethers.Contract(token, ERC20_ABI, provider);
    const [raw, decimals, symbol] = await Promise.all([
      c.balanceOf(address) as Promise<bigint>,
      c.decimals() as Promise<bigint>,
      c.symbol() as Promise<string>,
    ]);
    const dec = Number(decimals);
    return { amount: Number(ethers.formatUnits(raw, dec)), symbol, decimals: dec };
  } catch {
    return null;
  }
}
