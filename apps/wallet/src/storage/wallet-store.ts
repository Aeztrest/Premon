/**
 * Persistent storage for the wallet's EOA key material (Monad / EVM build).
 * Versioned so future schema changes can migrate cleanly. The v2 key is a
 * clean break from the prior storage shape — old blobs are ignored.
 */
const KEY = "premon.wallet.v2";

export interface PersistedWallet {
  /** EVM private key (0x-hex). Holds the full spending authority. */
  privateKey: string;
  /** BIP-39 mnemonic phrase when the wallet was generated from one; else null. */
  mnemonic: string | null;
  /** ISO timestamp of when the wallet was first created in this browser. */
  createdAt: string;
}

export function readWallet(): PersistedWallet | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedWallet>;
    if (!parsed.privateKey || !parsed.createdAt) return null;
    return {
      privateKey: parsed.privateKey,
      mnemonic: parsed.mnemonic ?? null,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

export function writeWallet(w: PersistedWallet): void {
  localStorage.setItem(KEY, JSON.stringify(w));
}

export function clearWallet(): void {
  localStorage.removeItem(KEY);
}

export function hasWallet(): boolean {
  return readWallet() !== null;
}
