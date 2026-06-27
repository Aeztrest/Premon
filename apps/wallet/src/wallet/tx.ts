/**
 * EVM transaction helpers: build an unsigned tx request (so the guard can
 * analyze it before any key touches it), then sign + optionally broadcast.
 * Mirrors the build/sign/submit pattern of the Stellar build, retargeted to
 * ethers v6 + Monad.
 */

import { ethers } from "ethers";
import type { TxRequest } from "@premon/wallet-adapter";
import { getProvider } from "./connection";
import type { WalletAccount } from "./keypair";

export interface BuildTransferArgs {
  from: string;
  to: string;
  /** MON amount as a decimal string, e.g. "0.01". */
  amountMon: string;
}

/**
 * Build an unsigned native-MON transfer as a JSON-serializable tx request. The
 * value is a decimal wei string so the guard can analyze it verbatim.
 */
export function buildNativeTransfer(args: BuildTransferArgs): TxRequest {
  return {
    from: args.from,
    to: args.to,
    value: ethers.parseEther(args.amountMon).toString(),
  };
}

export interface SignResult {
  /** 0x-hex signed serialized transaction. */
  signedTransaction: string;
  /** Broadcast tx hash when submitted, otherwise null. */
  hash: string | null;
}

/**
 * Sign a tx request with the wallet, then optionally broadcast it through the
 * Monad RPC. Returns the signed serialized tx and (if submitted) the tx hash.
 */
export async function signAndMaybeSubmit(
  tx: TxRequest,
  wallet: WalletAccount,
  submit: boolean,
): Promise<SignResult> {
  const provider = getProvider();
  const signer = wallet.connect(provider);

  const req: ethers.TransactionRequest = {
    to: tx.to ?? undefined,
    value: tx.value ? BigInt(tx.value) : undefined,
    data: tx.data ?? undefined,
  };
  if (tx.nonce !== undefined) req.nonce = tx.nonce;
  if (tx.gas) req.gasLimit = BigInt(tx.gas);
  if (tx.maxFeePerGas) req.maxFeePerGas = BigInt(tx.maxFeePerGas);
  if (tx.maxPriorityFeePerGas) req.maxPriorityFeePerGas = BigInt(tx.maxPriorityFeePerGas);
  if (tx.gasPrice) req.gasPrice = BigInt(tx.gasPrice);

  const populated = await signer.populateTransaction(req);
  const signedTransaction = await signer.signTransaction(populated);

  if (!submit) return { signedTransaction, hash: null };

  const resp = await provider.broadcastTransaction(signedTransaction);
  return { signedTransaction, hash: resp.hash };
}
