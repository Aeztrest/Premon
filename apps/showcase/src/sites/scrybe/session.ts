/**
 * Agentic x402 session for Scrybe.
 *
 * The "agent" is an ephemeral key generated in the browser. The user funds it
 * ONCE (one wallet approval) with a small native-MON budget; after that the
 * session key auto-signs + broadcasts each micropayment with NO popup — the
 * pre-funded budget IS the spending cap, the essence of agentic x402.
 *
 * The key is a throwaway holding only a tiny demo budget; it lives in
 * localStorage so the session survives reloads.
 */

import { JsonRpcProvider, Wallet, parseEther } from "ethers";

const RPC_URL = "https://testnet-rpc.monad.xyz";
const CHAIN_ID = 10143;
const STORAGE_KEY = "premon.scrybe.session.v1";

/** Top-up amount the user funds the agent with per funding (native MON). */
export const TOPUP_MON = "0.03";
/** Gas head-room kept on top of the payment when checking the budget. */
const GAS_BUFFER_WEI = parseEther("0.002");

let _provider: JsonRpcProvider | null = null;
export function getProvider(): JsonRpcProvider {
  return (_provider ??= new JsonRpcProvider(RPC_URL, CHAIN_ID));
}

export interface ScrybeSession {
  address: string;
  privateKey: string;
}

export function loadSession(): ScrybeSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ScrybeSession;
    if (s?.privateKey && s?.address) return s;
  } catch {
    /* ignore */
  }
  return null;
}

export function getOrCreateSession(): ScrybeSession {
  const existing = loadSession();
  if (existing) return existing;
  const w = Wallet.createRandom();
  const s: ScrybeSession = { address: w.address, privateKey: w.privateKey };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  return s;
}

export async function sessionBalanceWei(address: string): Promise<bigint> {
  return getProvider().getBalance(address);
}

/** True when the session can cover one more payment of `amountWei` (+ gas). */
export function canCover(balanceWei: bigint, amountWei: bigint): boolean {
  return balanceWei >= amountWei + GAS_BUFFER_WEI;
}

/** The MON amount to fund so the agent can keep paying. */
export function topUpWei(): bigint {
  return parseEther(TOPUP_MON);
}

/**
 * Pay `amountWei` from the agent session to `to`, signed + broadcast locally
 * (no wallet popup). Returns the tx hash once broadcast.
 */
export async function payFromSession(
  session: ScrybeSession,
  to: string,
  amountWei: bigint,
): Promise<string> {
  const wallet = new Wallet(session.privateKey, getProvider());
  const tx = await wallet.sendTransaction({ to, value: amountWei });
  return tx.hash;
}

/** Wait for a funding tx to mine so the agent's balance is spendable. */
export async function waitForFunding(txHash: string): Promise<void> {
  await getProvider().waitForTransaction(txHash, 1, 90_000);
}

export { CHAIN_ID };
