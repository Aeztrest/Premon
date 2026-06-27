/**
 * RPC handlers — one per method in @premon/ext-protocol's ExtRpc
 * (Monad / EVM build).
 */

import {
  Contract,
  formatUnits,
  isAddress,
  parseEther,
} from "ethers";
import browser from "webextension-polyfill";
import type {
  AnalyzeResponse,
  ExtRpcMethod,
  ExtRpcRequest,
  ExtRpcResponse,
} from "@premon/ext-protocol";
import { BALANCED_POLICY, type GuardPolicy } from "@premon/guard";

import { dispatch, getSnapshot } from "../state/store";
import { encryptWithPassphrase, decryptWithPassphrase } from "../crypto/kdf";
import {
  isUnlocked,
  lock,
  unlockWith,
  useWallet,
  walletFromSecret,
} from "../crypto/session";
import {
  clearKeystore,
  hasKeystore,
  readKeystore,
  writeKeystore,
} from "../db/keystore";
import { getProvider } from "../rpc/connection";
import { chainFor } from "../../shared/chain";
import { performSign } from "../provider/handlers";
import { closePopupWindow } from "../popup-window";
import {
  peek as peekById,
  take as takeSign,
  size as signQueueSize,
  snapshot as peekSign,
} from "../provider/sign-queue";
import { analyzeTransaction } from "../premon/analyze-client";
import {
  listAllowances,
  setStatus as setAllowanceStatus,
} from "../db/allowances";
import {
  appendHistory,
  getHistoryEntry,
  listHistory,
} from "../db/history";
import { countUnread, dismiss as dismissAlert, listAlerts } from "../db/alerts";

const POLICY_STORAGE_KEY = "premon.policy.v1";
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
] as const;

type Handler<M extends ExtRpcMethod> = (
  req: ExtRpcRequest<M>,
) => Promise<ExtRpcResponse<M>>;

const EMPTY_CHANGES: AnalyzeResponse["estimatedChanges"] = {
  native: [],
  assets: [],
  approvals: [],
};

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ────────────── Wallet lifecycle ────────────── */

const getStateHandler: Handler<"wallet.getState"> = async () => getSnapshot();

const createHandler: Handler<"wallet.create"> = async ({ passphrase, network }) => {
  if (await hasKeystore()) {
    throw new Error("A wallet already exists. Reset it before creating another.");
  }
  if (typeof passphrase !== "string" || passphrase.length < 8) {
    throw new Error("Passphrase must be at least 8 characters.");
  }

  const { generateMnemonic } = await import("bip39");
  const mnemonic = generateMnemonic(128); // 12-word BIP-39 phrase
  const wallet = walletFromSecret(mnemonic);

  const blob = await encryptWithPassphrase(enc.encode(mnemonic), passphrase);
  await writeKeystore({
    id: "primary",
    blob,
    address: wallet.address,
    secretType: "mnemonic",
    createdAt: Date.now(),
  });

  unlockWith(mnemonic);
  dispatch({ type: "network.set", network });
  dispatch({ type: "wallet.created", address: wallet.address });

  return { address: wallet.address };
};

const importHandler: Handler<"wallet.import"> = async ({ passphrase, secret }) => {
  if (await hasKeystore()) {
    throw new Error("A wallet already exists. Reset it before importing another.");
  }
  if (typeof passphrase !== "string" || passphrase.length < 8) {
    throw new Error("Passphrase must be at least 8 characters.");
  }
  const trimmed = secret.trim();
  const secretType: "mnemonic" | "privateKey" = trimmed.includes(" ") ? "mnemonic" : "privateKey";
  // Throws if the secret is malformed.
  const wallet = walletFromSecret(trimmed);

  const blob = await encryptWithPassphrase(enc.encode(trimmed), passphrase);
  await writeKeystore({
    id: "primary",
    blob,
    address: wallet.address,
    secretType,
    createdAt: Date.now(),
  });

  unlockWith(trimmed);
  dispatch({ type: "wallet.created", address: wallet.address });

  return { address: wallet.address };
};

const unlockHandler: Handler<"wallet.unlock"> = async ({ passphrase }) => {
  const row = await readKeystore();
  if (!row) throw new Error("No wallet found on this device.");
  const secretBytes = await decryptWithPassphrase(row.blob, passphrase);
  const secret = dec.decode(secretBytes);
  secretBytes.fill(0);

  const address = unlockWith(secret);
  dispatch({ type: "wallet.unlocked", address });
  return { ok: true };
};

const lockHandler: Handler<"wallet.lock"> = async () => {
  lock();
  return { ok: true };
};

const resetHandler: Handler<"wallet.reset"> = async ({ confirmation }) => {
  if (confirmation !== "I-UNDERSTAND") {
    throw new Error('Reset requires the confirmation token "I-UNDERSTAND".');
  }
  lock();
  await clearKeystore();
  dispatch({ type: "wallet.reset" });
  return { ok: true };
};

const exportSecretHandler: Handler<"wallet.exportSecret"> = async ({ passphrase, format }) => {
  const row = await readKeystore();
  if (!row) throw new Error("No wallet to export.");
  const secretBytes = await decryptWithPassphrase(row.blob, passphrase);
  const secret = dec.decode(secretBytes);
  secretBytes.fill(0);

  if (format === "mnemonic") {
    if (row.secretType !== "mnemonic") {
      throw new Error("This wallet was imported from a private key — no recovery phrase exists.");
    }
    return { secret };
  }
  // privateKey
  const wallet = walletFromSecret(secret);
  return { secret: wallet.privateKey };
};

/* ────────────── Balance + transfer ────────────── */

const balanceHandler: Handler<"wallet.balance"> = async ({ address }) => {
  const snap = getSnapshot();
  const target = address ?? snap.address;
  if (!target) throw new Error("No address available — wallet not initialized.");
  const provider = getProvider();
  const chain = chainFor(snap.network);

  let wei = "0";
  try {
    wei = (await provider.getBalance(target)).toString();
  } catch {
    /* keep 0 */
  }

  let usdc: string | null = null;
  try {
    const token = new Contract(chain.usdcAddress, ERC20_ABI, provider);
    const raw = (await token.getFunction("balanceOf")(target)) as bigint;
    usdc = formatUnits(raw, chain.usdcDecimals);
  } catch {
    usdc = null;
  }

  return { wei, usdc };
};

const transferNativeHandler: Handler<"wallet.transferNative"> = async ({ to, amountEth }) => {
  if (!isUnlocked()) throw new Error("Unlock the wallet first.");
  if (!isAddress(to)) throw new Error("Invalid recipient address.");
  const amount = Number(amountEth);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a positive number.");
  }

  const provider = getProvider();
  const signer = useWallet().connect(provider);
  const sent = await signer.sendTransaction({ to, value: parseEther(amountEth) });

  await appendHistory({
    type: "send",
    txHash: sent.hash,
    origin: null,
    summary: `Sent ${amountEth} MON → ${to.slice(0, 6)}…${to.slice(-4)}`,
    decision: "allow",
    reasons: [],
    broadcast: true,
    createdAt: Date.now(),
  });

  return { txHash: sent.hash };
};

/* ────────────── Network ────────────── */

const networkSet: Handler<"network.set"> = async ({ network }) => {
  dispatch({ type: "network.set", network });
  return { ok: true };
};

/* ────────────── Allowance ledger ────────────── */

const ledgerListHandler: Handler<"ledger.list"> = async ({ filter } = {}) => {
  return listAllowances(filter);
};

const ledgerPauseHandler: Handler<"ledger.pause"> = async ({ merchantOrigin }) => {
  const all = await listAllowances();
  const target = all.find((a) => a.merchantOrigin === merchantOrigin);
  if (!target) throw new Error(`No allowance found for ${merchantOrigin}`);
  await setAllowanceStatus(target.id, "paused");
  return { ok: true };
};

const ledgerUnpauseHandler: Handler<"ledger.unpause"> = async ({ merchantOrigin }) => {
  const all = await listAllowances();
  const target = all.find((a) => a.merchantOrigin === merchantOrigin);
  if (!target) throw new Error(`No allowance found for ${merchantOrigin}`);
  await setAllowanceStatus(target.id, "active");
  return { ok: true };
};

const ledgerRevokeHandler: Handler<"ledger.revoke"> = async ({ merchantOrigin }) => {
  const all = await listAllowances();
  const targets = all.filter((a) => a.merchantOrigin === merchantOrigin);
  if (targets.length === 0) throw new Error(`No allowance found for ${merchantOrigin}`);
  for (const t of targets) await setAllowanceStatus(t.id, "revoked");
  await appendHistory({
    type: "alert",
    txHash: null,
    origin: merchantOrigin,
    summary: `Revoked allowance for ${merchantOrigin}`,
    decision: "block",
    reasons: ["User-initiated revoke. Future x402 payments to this merchant are blocked."],
    broadcast: false,
    createdAt: Date.now(),
  });
  return { signRequestId: `local-${Date.now()}` };
};

/* ────────────── Policy ────────────── */

const policyReadHandler: Handler<"policy.read"> = async () => {
  const all = await browser.storage.local.get(POLICY_STORAGE_KEY);
  return (all[POLICY_STORAGE_KEY] as GuardPolicy | undefined) ?? BALANCED_POLICY;
};

const policyWriteHandler: Handler<"policy.write"> = async ({ policy }) => {
  await browser.storage.local.set({ [POLICY_STORAGE_KEY]: policy });
  return { ok: true };
};

async function loadPolicy(): Promise<GuardPolicy> {
  const all = await browser.storage.local.get(POLICY_STORAGE_KEY);
  return (all[POLICY_STORAGE_KEY] as GuardPolicy | undefined) ?? BALANCED_POLICY;
}

/* ────────────── History + alerts ────────────── */

const historyListHandler: Handler<"history.list"> = async ({ filter } = {}) => {
  return listHistory(filter);
};

const historyDetailHandler: Handler<"history.detail"> = async ({ id }) => {
  const r = await getHistoryEntry(id);
  if (!r) throw new Error("History entry not found");
  let analysis: unknown = null;
  const json = (r as { analysisJson?: string }).analysisJson;
  if (json) {
    try { analysis = JSON.parse(json); } catch { /* ignore */ }
  }
  return { ...r, analysis };
};

const alertsListHandler: Handler<"alerts.list"> = async ({ includeDismissed } = {}) => {
  return listAlerts({ includeDismissed });
};

const alertsDismissHandler: Handler<"alerts.dismiss"> = async ({ id }) => {
  await dismissAlert(id);
  const remaining = await countUnread();
  dispatch({ type: "alerts.set", count: remaining });
  return { ok: true };
};

/* ────────────── Sign request drain ────────────── */

const txPeekRequestHandler: Handler<"tx.peekRequest"> = async () => peekSign();

const txAnalyzeRequestHandler: Handler<"tx.analyzeRequest"> = async ({ requestId }) => {
  const req = peekById(requestId);
  if (!req) {
    throw new Error("Sign request not found — it may already have been processed.");
  }
  const snap = getSnapshot();
  if (!snap.address) throw new Error("Wallet not initialized.");

  if (req.kind === "message" || req.kind === "typedData" || req.kind === "connect") {
    const note =
      req.kind === "connect"
        ? "Site is requesting connection. No funds move until you approve a signature."
        : req.kind === "typedData"
          ? "Typed-data signature — review the structured message below. No funds move on-chain."
          : "Plain message — no funds move on-chain.";
    return advisory(note);
  }

  if (req.kind === "x402Payment") {
    return advisory("x402 micropayment — settled off-chain via the facilitator under your caps.");
  }

  // transaction / transactionAndSend
  let txObject: unknown;
  try {
    txObject = JSON.parse(req.payload);
  } catch {
    return advisory("Could not decode the transaction for analysis.");
  }
  const policy = await loadPolicy();
  return analyzeTransaction(
    {
      network: snap.network,
      transaction: txObject as Record<string, unknown>,
      userWallet: snap.address,
      policy,
    },
    { apiKey: "dev-key-change-me" },
  );
};

function advisory(note: string): AnalyzeResponse {
  return {
    decision: "advisory",
    safe: true,
    blockingReasons: [],
    advisoryReasons: [note],
    reasons: [note],
    riskFindings: [],
    estimatedChanges: EMPTY_CHANGES,
    simulationWarnings: [],
    offline: false,
  };
}

function endSignFlowIfDrained(): void {
  if (signQueueSize() === 0) {
    dispatch({ type: "sign.end" });
    void closePopupWindow();
  }
}

const txSignHandler: Handler<"tx.sign"> = async ({ requestId, accept, remember }) => {
  const req = takeSign(requestId);
  if (!req) {
    throw new Error("Unknown sign request — it may have already been processed.");
  }

  if (req.kind === "connect") {
    if (!accept) {
      req.reject(new Error("User rejected the connection."));
      endSignFlowIfDrained();
      return { rejection: "User declined" };
    }
    req.resolve({ kind: "connect", rememberOrigin: remember === true });
    endSignFlowIfDrained();
    return { ok: true };
  }

  if (!accept) {
    req.reject(new Error("User declined the signature."));
    endSignFlowIfDrained();
    await appendHistory({
      type: req.kind === "x402Payment" ? "x402" : "dapp",
      txHash: null,
      origin: req.origin,
      summary: `Declined ${kindLabel(req.kind)} from ${req.origin}`,
      decision: "block",
      reasons: ["User declined at sign request"],
      broadcast: false,
      createdAt: Date.now(),
    });
    return { rejection: "User declined" };
  }

  try {
    const result = await performSign(req.kind, req.payload);
    req.resolve(result);
    endSignFlowIfDrained();

    const txHash = result.kind === "transactionAndSend" ? result.txHash : null;
    await appendHistory({
      type: req.kind === "x402Payment" ? "x402" : "dapp",
      txHash,
      origin: req.origin,
      summary: `Signed ${kindLabel(req.kind)} for ${req.origin}`,
      decision: "allow",
      reasons: [],
      broadcast: result.kind === "transactionAndSend",
      createdAt: Date.now(),
    });

    if (result.kind === "transactionAndSend") return { txHash: result.txHash };
    if (result.kind === "transaction") return { signed: result.signedTransaction };
    if (result.kind === "typedData") return { signed: result.signature };
    if (result.kind === "message") return { signed: result.signature };
    if (result.kind === "x402Payment") return { ok: true };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.reject(new Error(message));
    endSignFlowIfDrained();
    await appendHistory({
      type: "alert",
      txHash: null,
      origin: req.origin,
      summary: `Sign failed for ${req.origin}`,
      decision: "block",
      reasons: [message],
      broadcast: false,
      createdAt: Date.now(),
    });
    throw err;
  }
};

const txSendHandler: Handler<"tx.send"> = async ({ signedTransaction }) => {
  const provider = getProvider();
  const sent = await provider.broadcastTransaction(signedTransaction);
  return { txHash: sent.hash };
};

function kindLabel(kind: string): string {
  if (kind === "connect") return "connect";
  if (kind === "message") return "message";
  if (kind === "typedData") return "typed data";
  if (kind === "x402Payment") return "x402 payment";
  if (kind === "transactionAndSend") return "transaction";
  return "transaction";
}

/* ────────────── Registry ────────────── */

export const handlers: { [M in ExtRpcMethod]: Handler<M> } = {
  "wallet.getState": getStateHandler,
  "wallet.create": createHandler,
  "wallet.import": importHandler,
  "wallet.unlock": unlockHandler,
  "wallet.lock": lockHandler,
  "wallet.reset": resetHandler,
  "wallet.exportSecret": exportSecretHandler,
  "wallet.balance": balanceHandler,
  "wallet.transferNative": transferNativeHandler,

  "network.set": networkSet,

  "tx.sign": txSignHandler,
  "tx.send": txSendHandler,
  "tx.peekRequest": txPeekRequestHandler,
  "tx.analyzeRequest": txAnalyzeRequestHandler,

  "ledger.list": ledgerListHandler,
  "ledger.revoke": ledgerRevokeHandler,
  "ledger.pause": ledgerPauseHandler,
  "ledger.unpause": ledgerUnpauseHandler,

  "policy.read": policyReadHandler,
  "policy.write": policyWriteHandler,

  "history.list": historyListHandler,
  "history.detail": historyDetailHandler,

  "alerts.list": alertsListHandler,
  "alerts.dismiss": alertsDismissHandler,
};
