/**
 * In-memory session: holds the decrypted EOA secret while the wallet is
 * unlocked. Service worker memory only; never persisted.
 *
 * Monad / EVM build: the secret is either a BIP-39 mnemonic phrase or a raw
 * 0x-hex private key. `useWallet()` rebuilds a fresh ethers signer from it on
 * every call and renews the idle timer; after `idleTimeoutMs` of inactivity
 * the session clears the secret and dispatches `wallet.locked`.
 */

import { HDNodeWallet, Mnemonic, Wallet } from "ethers";
import { dispatch, getState } from "../state/store";

export type EvmSigner = HDNodeWallet | Wallet;

let secret: string | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

export function isUnlocked(): boolean {
  return secret !== null;
}

/** Build an ethers signer from a mnemonic phrase or 0x private key. */
export function walletFromSecret(secretValue: string): EvmSigner {
  const trimmed = secretValue.trim();
  if (trimmed.includes(" ")) {
    if (!Mnemonic.isValidMnemonic(trimmed)) {
      throw new Error("Invalid recovery phrase.");
    }
    return HDNodeWallet.fromPhrase(trimmed);
  }
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("Invalid private key — expected 32 bytes of hex.");
  }
  return new Wallet(hex);
}

/** Unlock with a decrypted secret. Returns the derived EOA address (0x). */
export function unlockWith(secretValue: string): string {
  const w = walletFromSecret(secretValue);
  secret = secretValue;
  resetIdle();
  return w.address;
}

/**
 * Returns a fresh ethers signer backed by the unlocked secret. Renews the
 * idle timer. Throws when the wallet is locked.
 */
export function useWallet(): EvmSigner {
  if (!secret) throw new Error("Wallet is locked. Unlock before signing.");
  resetIdle();
  return walletFromSecret(secret);
}

export function lock(): void {
  secret = null;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  dispatch({ type: "wallet.locked" });
}

function resetIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  const ms = getState().idleTimeoutMs;
  idleTimer = setTimeout(() => {
    console.info("[PREMON] idle timeout — locking wallet");
    lock();
  }, ms);
}
