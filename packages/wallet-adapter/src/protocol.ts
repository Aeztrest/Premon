/**
 * postMessage protocol between a dApp and the Premon wallet popup (Monad build).
 * All messages tagged `__bt: "1"` so we can distinguish ours from unrelated
 * traffic on the page.
 *
 * The transport is JSON-serializable EVM transaction requests + 0x-hex signed
 * transactions, so this package does not depend on ethers at runtime.
 */

export const PROTO_TAG = "__bt";
export const PROTO_VERSION = "1";

export type RequestId = string;

/** An unsigned/partial EVM transaction request (JSON-serializable). */
export interface TxRequest {
  from?: string;
  to?: string | null;
  /** Wei value as a decimal or 0x-hex string. */
  value?: string;
  /** Calldata, 0x-hex. */
  data?: string;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
  nonce?: number;
  chainId?: number;
}

/* ────────────── popup → opener ────────────── */

export interface PopupReadyMessage {
  __bt: typeof PROTO_VERSION;
  type: "popup-ready";
  requestId: RequestId;
}

export interface ConnectApprovedMessage {
  __bt: typeof PROTO_VERSION;
  type: "connect-approved";
  requestId: RequestId;
  /** The connected EOA address (0x). Assets live here. */
  address: string;
  /** Active chain id (e.g. 10143 for Monad testnet). */
  chainId: number;
}

export interface ConnectRejectedMessage {
  __bt: typeof PROTO_VERSION;
  type: "connect-rejected";
  requestId: RequestId;
  reason: string;
}

export interface SignApprovedMessage {
  __bt: typeof PROTO_VERSION;
  type: "sign-approved";
  requestId: RequestId;
  /** 0x-hex signed serialized transaction. */
  signedTransaction: string;
  /** Present only when mode=signAndSend — the broadcast tx hash. */
  txHash?: string;
}

export interface SignRejectedMessage {
  __bt: typeof PROTO_VERSION;
  type: "sign-rejected";
  requestId: RequestId;
  reason: string;
  /** When Premon policy blocked, this contains the analysis JSON. */
  analysisJson?: string;
}

export type PopupOutgoing =
  | PopupReadyMessage
  | ConnectApprovedMessage
  | ConnectRejectedMessage
  | SignApprovedMessage
  | SignRejectedMessage;

/* ────────────── opener → popup ────────────── */

export interface ConnectRequestMessage {
  __bt: typeof PROTO_VERSION;
  type: "connect-request";
  requestId: RequestId;
  origin: string;
  appName?: string;
}

export interface SignRequestMessage {
  __bt: typeof PROTO_VERSION;
  type: "sign-request";
  requestId: RequestId;
  origin: string;
  appName?: string;
  /** The EVM transaction request to sign. */
  transaction: TxRequest;
  /** sign = return signed tx, signAndSend = also broadcast through the RPC. */
  mode: "sign" | "signAndSend";
}

export type OpenerOutgoing = ConnectRequestMessage | SignRequestMessage;

/* ────────────── helpers ────────────── */

export function isProtoMessage(
  data: unknown,
): data is { __bt: string; type: string; requestId: string } {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    d[PROTO_TAG] === PROTO_VERSION &&
    typeof d.type === "string" &&
    typeof d.requestId === "string"
  );
}

export function newRequestId(): string {
  let s = "";
  for (let i = 0; i < 8; i++)
    s += ((Math.random() * 65536) | 0).toString(16).padStart(4, "0");
  return s;
}
