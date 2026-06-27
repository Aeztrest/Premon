/**
 * Pending sign-request queue. Lives in the service worker between the moment a
 * dApp request arrives (via the inpage EIP-1193 provider → content script) and
 * the moment the popup UI returns the user's verdict (`tx.sign`).
 */

export type SignKind =
  | "message"            // personal_sign
  | "typedData"          // eth_signTypedData_v4
  | "transaction"        // eth_signTransaction (sign only)
  | "transactionAndSend" // eth_sendTransaction (sign + broadcast)
  | "x402Payment"        // x402 micropayment (sign + build header)
  | "connect";           // eth_requestAccounts approval

export interface SignRequest {
  requestId: string;
  kind: SignKind;
  origin: string;
  /**
   * Request payload, encoded as a string:
   *  - message:            the raw message (utf-8 or 0x-hex)
   *  - typedData:          JSON string of the EIP-712 typed-data document
   *  - transaction(s):     JSON string of the ethers TransactionRequest
   *  - x402Payment:        JSON string of the built payment context
   */
  payload: string;
  /** Free-form display label rendered in the popup. */
  label?: string;
  resolve: (out: SignSuccess) => void;
  reject: (err: Error) => void;
}

export type SignSuccess =
  | { kind: "transaction"; signedTransaction: string; signerAddress: string }
  | { kind: "transactionAndSend"; txHash: string; signerAddress: string }
  | { kind: "typedData"; signature: string; signerAddress: string }
  | { kind: "x402Payment"; headerValue: string; amountUi: number; signerAddress: string }
  | { kind: "message"; signature: string; signerAddress: string }
  | { kind: "connect"; rememberOrigin: boolean };

const queue = new Map<string, SignRequest>();

export function enqueue(req: SignRequest): void {
  queue.set(req.requestId, req);
}

export function take(requestId: string): SignRequest | undefined {
  const r = queue.get(requestId);
  if (r) queue.delete(requestId);
  return r;
}

export function peek(requestId: string): SignRequest | undefined {
  return queue.get(requestId);
}

export function size(): number {
  return queue.size;
}

export function snapshot(): {
  requestId: string;
  kind: SignKind;
  origin: string;
  payload: string;
  label?: string;
} | null {
  const first = queue.values().next();
  if (first.done) return null;
  const r = first.value;
  return {
    requestId: r.requestId,
    kind: r.kind,
    origin: r.origin,
    payload: r.payload,
    label: r.label,
  };
}

export function newRequestId(): string {
  let s = "";
  for (let i = 0; i < 8; i++)
    s += ((Math.random() * 65536) | 0).toString(16).padStart(4, "0");
  return s;
}
