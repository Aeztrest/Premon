import { Transaction, getAddress, isAddress } from "ethers";
import type { TxRequestObject } from "../domain/policy.js";

/**
 * SDK-independent, normalized view of an EVM transaction. This is the EVM
 * analogue of the decoded Stellar `Transaction` — every downstream stage
 * (account collection, simulation, delta extraction, detectors) consumes this
 * shape, never ethers directly.
 */
export type DecodedEvmTx = {
  /** Sender (checksummed). Recovered from a signed raw tx, or taken from the request. */
  from: string | null;
  /** Recipient (checksummed); null for contract-creation. */
  to: string | null;
  /** Native value moved, in wei. */
  value: bigint;
  /** Calldata, 0x-prefixed (`"0x"` when empty). */
  data: string;
  nonce: number | null;
  chainId: number | null;
  gasLimit: bigint | null;
  /** EIP-1559 max fee per gas (wei); null for legacy txs. */
  maxFeePerGas: bigint | null;
  /** Legacy gas price (wei); null for EIP-1559 txs. */
  gasPrice: bigint | null;
  /** Effective gas price used for fee estimation: maxFeePerGas ?? gasPrice. */
  effectiveGasPriceWei: bigint | null;
  type: number | null;
};

export class TxDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxDecodeError";
  }
}

function parseBigintLoose(v: unknown): bigint | null {
  if (v == null) return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    try {
      return s.startsWith("0x") || s.startsWith("0X") ? BigInt(s) : BigInt(s);
    } catch {
      throw new TxDecodeError(`Not a valid integer: ${v}`);
    }
  }
  return null;
}

function parseIntLoose(v: unknown): number | null {
  const b = parseBigintLoose(v);
  return b == null ? null : Number(b);
}

function normalizeAddr(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  if (!isAddress(v)) throw new TxDecodeError(`Not a valid EVM address: ${v}`);
  return getAddress(v);
}

/** Decodes a raw serialized transaction (signed or unsigned), 0x-hex. */
export function decodeRawTransaction(raw: string): DecodedEvmTx {
  let tx: Transaction;
  try {
    tx = Transaction.from(raw.trim());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new TxDecodeError(`Could not parse raw transaction: ${msg}`);
  }
  const maxFeePerGas = tx.maxFeePerGas ?? null;
  const gasPrice = tx.gasPrice ?? null;
  return {
    // `tx.from` is populated only when the raw tx carries a valid signature.
    from: tx.from ? getAddress(tx.from) : null,
    to: tx.to ? getAddress(tx.to) : null,
    value: tx.value ?? 0n,
    data: tx.data && tx.data !== "0x" ? tx.data : "0x",
    nonce: typeof tx.nonce === "number" ? tx.nonce : null,
    chainId: tx.chainId != null ? Number(tx.chainId) : null,
    gasLimit: tx.gasLimit ?? null,
    maxFeePerGas,
    gasPrice,
    effectiveGasPriceWei: maxFeePerGas ?? gasPrice,
    type: tx.type ?? null,
  };
}

/** Normalizes a partial tx-request object into a DecodedEvmTx. */
export function decodeTxRequestObject(obj: TxRequestObject): DecodedEvmTx {
  const data =
    (typeof obj.data === "string" && obj.data) ||
    (typeof obj.input === "string" && obj.input) ||
    "0x";
  const normData = data === "" ? "0x" : data.startsWith("0x") ? data : `0x${data}`;
  const maxFeePerGas = parseBigintLoose(obj.maxFeePerGas);
  const gasPrice = parseBigintLoose(obj.gasPrice);
  return {
    from: normalizeAddr(obj.from),
    to: obj.to == null ? null : normalizeAddr(obj.to),
    value: parseBigintLoose(obj.value) ?? 0n,
    data: normData,
    nonce: parseIntLoose(obj.nonce),
    chainId: parseIntLoose(obj.chainId),
    gasLimit: parseBigintLoose(obj.gas ?? obj.gasLimit),
    maxFeePerGas,
    gasPrice,
    effectiveGasPriceWei: maxFeePerGas ?? gasPrice,
    type: parseIntLoose(obj.type),
  };
}

/** Dispatches on the `transaction` field shape (raw hex vs. request object). */
export function decodeTransaction(
  transaction: string | TxRequestObject,
): DecodedEvmTx {
  if (typeof transaction === "string") {
    const s = transaction.trim();
    // A raw serialized tx is a long 0x blob; a bare address is 42 chars.
    if (!s.startsWith("0x")) {
      throw new TxDecodeError("Raw transaction string must be 0x-prefixed hex");
    }
    return decodeRawTransaction(s);
  }
  return decodeTxRequestObject(transaction);
}
