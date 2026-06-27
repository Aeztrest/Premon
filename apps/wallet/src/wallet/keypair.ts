import { Wallet, HDNodeWallet } from "ethers";
import { readWallet, writeWallet, type PersistedWallet } from "../storage/wallet-store";

/** Either an HD wallet (from a mnemonic) or a bare key wallet — both can sign. */
export type WalletAccount = HDNodeWallet | Wallet;

/**
 * Generate a fresh EVM wallet (with a BIP-39 mnemonic) and persist it to
 * localStorage. Throws if a wallet already exists — caller must explicitly
 * reset first to avoid accidental key destruction.
 */
export function createNewWallet(): { wallet: HDNodeWallet; mnemonic: string | null } {
  if (readWallet()) {
    throw new Error("A wallet already exists. Reset before creating a new one.");
  }
  const wallet = Wallet.createRandom();
  const persisted: PersistedWallet = {
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase ?? null,
    createdAt: new Date().toISOString(),
  };
  writeWallet(persisted);
  return { wallet, mnemonic: persisted.mnemonic };
}

/**
 * Load the existing wallet from storage. Returns null if no wallet has been
 * created in this browser.
 */
export function loadExistingWallet():
  | { wallet: Wallet; mnemonic: string | null; createdAt: string }
  | null {
  const persisted = readWallet();
  if (!persisted) return null;
  const wallet = new Wallet(persisted.privateKey);
  return {
    wallet,
    mnemonic: persisted.mnemonic,
    createdAt: persisted.createdAt,
  };
}
