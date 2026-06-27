/**
 * EIP-1193 provider handlers — the dApp-facing surface (Monad build).
 *
 * `eth_requestAccounts` resolves immediately when the origin is already
 * trusted; otherwise it queues a connect-approval popup. Signing methods queue
 * a sign request and wait for the popup to return the user's verdict via
 * `tx.sign`.
 *
 * The transport carries plain JSON payloads — see ExtProviderMethods in
 * @premon/ext-protocol.
 */

import {
  getBytes,
  isHexString,
  TransactionRequest,
} from "ethers";
import type { ExtProviderMethods } from "@premon/ext-protocol";

import { dispatch, getState } from "../state/store";
import { isUnlocked, useWallet } from "../crypto/session";
import { getProvider } from "../rpc/connection";
import { chainFor, chainForId } from "../../shared/chain";
import {
  enqueue,
  newRequestId,
  type SignKind,
  type SignSuccess,
} from "./sign-queue";
import { appendHistory, listHistory } from "../db/history";
import { readSitePermission, writeSitePermission } from "../db/site-permissions";
import { signX402Payment, type BuiltX402Payment } from "../x402/build";
import { x402Review } from "../x402/handlers";

export type ProviderHandler = (payload: unknown) => Promise<unknown>;

type Req<M extends keyof ExtProviderMethods> = ExtProviderMethods[M]["req"];
type Rsp<M extends keyof ExtProviderMethods> = ExtProviderMethods[M]["rsp"];

/* ────────────── Connect ────────────── */

function ensureReady(): string {
  const s = getState();
  if (s.phase === "uninitialized") {
    throw new Error("Premon wallet not initialized — open the wallet to set it up first.");
  }
  if (s.phase === "locked") {
    throw new Error("Premon wallet is locked — open the wallet to unlock it first.");
  }
  if (!s.address) throw new Error("Wallet not ready.");
  return s.address;
}

const ethRequestAccounts: ProviderHandler = async (raw) => {
  const { origin } = raw as Req<"eth_requestAccounts">;
  if (!origin) throw new Error("Origin required");
  const address = ensureReady();

  const perm = await readSitePermission(origin);
  if (perm?.status === "denied" && perm.remembered) {
    throw new Error(`Connection to ${origin} was previously denied.`);
  }
  if (!(perm?.status === "trusted" && perm.remembered)) {
    const approval = await queueConnectApproval(origin);
    if (!approval.allow) {
      if (approval.remember) {
        await writeSitePermission({ origin, status: "denied", remembered: true, grantedAt: Date.now() });
      }
      throw new Error("User rejected the connection.");
    }
    if (approval.remember) {
      await writeSitePermission({ origin, status: "trusted", remembered: true, grantedAt: Date.now() });
    }
  }

  try {
    const prior = await listHistory({ type: "dapp", origin });
    if (prior.length === 0) {
      await appendHistory({
        type: "dapp",
        txHash: null,
        origin,
        summary: "Connected via EIP-1193 provider",
        decision: "allow",
        reasons: [],
        broadcast: false,
        createdAt: Date.now(),
      });
    }
  } catch (err) {
    console.warn("[PREMON] failed to record connect:", err);
  }

  return { accounts: [address] } satisfies Rsp<"eth_requestAccounts">;
};

const ethAccounts: ProviderHandler = async (raw) => {
  const { origin } = raw as Req<"eth_accounts">;
  const s = getState();
  const perm = await readSitePermission(origin);
  const trusted = perm?.status === "trusted";
  if (trusted && s.address && isUnlocked()) {
    return { accounts: [s.address] } satisfies Rsp<"eth_accounts">;
  }
  return { accounts: [] } satisfies Rsp<"eth_accounts">;
};

const ethChainId: ProviderHandler = async () => {
  const s = getState();
  return { chainId: chainFor(s.network).chainIdHex } satisfies Rsp<"eth_chainId">;
};

const walletSwitchEthereumChain: ProviderHandler = async (raw) => {
  const { chainId } = raw as Req<"wallet_switchEthereumChain">;
  const numeric = Number.parseInt(chainId, 16);
  const target = chainForId(numeric);
  if (!target) {
    throw new Error(`Unsupported chain ${chainId}. Premon supports Monad testnet + mainnet.`);
  }
  dispatch({ type: "network.set", network: target.network });
  return { ok: true } satisfies Rsp<"wallet_switchEthereumChain">;
};

/* ────────────── Sign methods ────────────── */

function queueAndWait(kind: SignKind, origin: string, payload: string): Promise<SignSuccess> {
  if (!isUnlocked()) {
    return Promise.reject(new Error("Premon wallet is locked."));
  }
  return new Promise<SignSuccess>((resolve, reject) => {
    const requestId = newRequestId();
    enqueue({ requestId, kind, origin, payload, resolve, reject });
    dispatch({ type: "sign.start" });
  });
}

const personalSign: ProviderHandler = async (raw) => {
  const { origin, message } = raw as Req<"personal_sign">;
  const result = await queueAndWait("message", origin, message);
  if (result.kind !== "message") throw new Error("Unexpected sign result kind");
  return { signature: result.signature } satisfies Rsp<"personal_sign">;
};

const ethSignTypedDataV4: ProviderHandler = async (raw) => {
  const { origin, typedData } = raw as Req<"eth_signTypedData_v4">;
  const result = await queueAndWait("typedData", origin, typedData);
  if (result.kind !== "typedData") throw new Error("Unexpected sign result kind");
  return { signature: result.signature } satisfies Rsp<"eth_signTypedData_v4">;
};

const ethSendTransaction: ProviderHandler = async (raw) => {
  const { origin, transaction } = raw as Req<"eth_sendTransaction">;
  const result = await queueAndWait("transactionAndSend", origin, JSON.stringify(transaction));
  if (result.kind !== "transactionAndSend") throw new Error("Unexpected sign result kind");
  return { txHash: result.txHash } satisfies Rsp<"eth_sendTransaction">;
};

const ethSignTransaction: ProviderHandler = async (raw) => {
  const { origin, transaction } = raw as Req<"eth_signTransaction">;
  const result = await queueAndWait("transaction", origin, JSON.stringify(transaction));
  if (result.kind !== "transaction") throw new Error("Unexpected sign result kind");
  return { signedTransaction: result.signedTransaction } satisfies Rsp<"eth_signTransaction">;
};

function queueConnectApproval(origin: string): Promise<{ allow: boolean; remember: boolean }> {
  return new Promise((resolve) => {
    const requestId = newRequestId();
    enqueue({
      requestId,
      kind: "connect",
      origin,
      payload: "",
      label: `Connect ${origin}`,
      resolve: (out) => {
        if (out.kind !== "connect") return resolve({ allow: false, remember: false });
        resolve({ allow: true, remember: out.rememberOrigin });
      },
      reject: () => resolve({ allow: false, remember: false }),
    });
    dispatch({ type: "sign.start" });
  });
}

/* ────────────── Pure signing (used by the tx.sign drain handler) ────────────── */

/** Normalize a dApp tx request into an ethers TransactionRequest. */
function normalizeTx(input: unknown): TransactionRequest {
  const t = (input ?? {}) as Record<string, unknown>;
  const out: TransactionRequest = {};
  if (typeof t.to === "string") out.to = t.to;
  if (typeof t.from === "string") out.from = t.from;
  if (t.value !== undefined && t.value !== null) out.value = BigInt(t.value as string);
  if (typeof t.data === "string") out.data = t.data;
  if (typeof t.input === "string" && !out.data) out.data = t.input;
  const gas = t.gas ?? t.gasLimit;
  if (gas !== undefined && gas !== null) out.gasLimit = BigInt(gas as string);
  if (t.maxFeePerGas !== undefined && t.maxFeePerGas !== null) out.maxFeePerGas = BigInt(t.maxFeePerGas as string);
  if (t.maxPriorityFeePerGas !== undefined && t.maxPriorityFeePerGas !== null)
    out.maxPriorityFeePerGas = BigInt(t.maxPriorityFeePerGas as string);
  if (t.gasPrice !== undefined && t.gasPrice !== null) out.gasPrice = BigInt(t.gasPrice as string);
  if (t.nonce !== undefined && t.nonce !== null) out.nonce = Number(t.nonce);
  return out;
}

export async function performSign(kind: SignKind, payload: string): Promise<SignSuccess> {
  const signer = useWallet();

  if (kind === "message") {
    const data = isHexString(payload) ? getBytes(payload) : payload;
    const signature = await signer.signMessage(data);
    return { kind: "message", signature, signerAddress: signer.address };
  }

  if (kind === "typedData") {
    const doc = JSON.parse(payload) as {
      domain: Record<string, unknown>;
      types: Record<string, { name: string; type: string }[]>;
      message: Record<string, unknown>;
      primaryType?: string;
    };
    const types = { ...doc.types };
    delete (types as Record<string, unknown>).EIP712Domain;
    const signature = await signer.signTypedData(doc.domain, types, doc.message);
    return { kind: "typedData", signature, signerAddress: signer.address };
  }

  if (kind === "x402Payment") {
    const { built } = JSON.parse(payload) as { built: BuiltX402Payment; requestUrl: string };
    const headerValue = await signX402Payment(signer, built);
    return { kind: "x402Payment", headerValue, amountUi: built.amountUi, signerAddress: signer.address };
  }

  // Transaction kinds.
  const provider = getProvider();
  const connected = signer.connect(provider);
  const tx = normalizeTx(JSON.parse(payload));

  if (kind === "transaction") {
    const populated = await connected.populateTransaction(tx);
    const signedTransaction = await connected.signTransaction(populated);
    return { kind: "transaction", signedTransaction, signerAddress: signer.address };
  }

  // transactionAndSend
  const sent = await connected.sendTransaction(tx);
  return { kind: "transactionAndSend", txHash: sent.hash, signerAddress: signer.address };
}

/* ────────────── Registries ────────────── */

export const provider_handlers: Record<string, ProviderHandler> = {
  eth_requestAccounts: ethRequestAccounts,
  eth_accounts: ethAccounts,
  eth_chainId: ethChainId,
  wallet_switchEthereumChain: walletSwitchEthereumChain,
  personal_sign: personalSign,
  eth_signTypedData_v4: ethSignTypedDataV4,
  eth_sendTransaction: ethSendTransaction,
  eth_signTransaction: ethSignTransaction,
};

export const x402_handlers: Record<string, ProviderHandler> = {
  "x402.review": x402Review,
};
