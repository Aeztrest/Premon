import {
  isProtoMessage,
  newRequestId,
  PROTO_VERSION,
  type ConnectRequestMessage,
  type PopupOutgoing,
  type SignRequestMessage,
  type TxRequest,
} from "./protocol.js";

export class WalletAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "WalletAdapterError";
  }
}

export interface PremonAdapterOptions {
  /** Origin of the wallet, e.g. http://localhost:5180 */
  walletUrl: string;
  appName?: string;
  /** How long to wait for the popup to respond (ms). Default 5 min. */
  timeoutMs?: number;
  popupFeatures?: string;
}

export interface ConnectedAccount {
  /** Connected EOA address (0x). Use as `from` in EVM txs. */
  address: string;
  chainId: number;
}

const DEFAULT_TIMEOUT = 5 * 60_000;
const DEFAULT_FEATURES = "popup=yes,width=440,height=720,top=80,left=80";

type Listener = (msg: PopupOutgoing) => void;

/**
 * dApp-side adapter for the Premon wallet (Monad build). Opens popups to the
 * wallet's /connect and /sign routes; handshakes via postMessage; returns
 * signed 0x-hex transactions.
 *
 * Every signature is gated by the wallet's policy — the wallet runs the Premon
 * analysis and shows it to the user before allowing the sign. This adapter
 * cannot bypass that, by design.
 */
export class PremonAdapter {
  private account: ConnectedAccount | null = null;

  constructor(private readonly opts: PremonAdapterOptions) {
    if (!opts.walletUrl)
      throw new WalletAdapterError("walletUrl is required", "INVALID_CONFIG");
  }

  get connected(): boolean {
    return this.account !== null;
  }
  get connectedAccount(): ConnectedAccount | null {
    return this.account;
  }
  get walletOrigin(): string {
    try {
      return new URL(this.opts.walletUrl).origin;
    } catch {
      throw new WalletAdapterError(
        `Invalid walletUrl: ${this.opts.walletUrl}`,
        "INVALID_CONFIG",
      );
    }
  }

  async connect(): Promise<ConnectedAccount> {
    const requestId = newRequestId();
    const popup = this.openPopup(`${this.opts.walletUrl}/connect`, "premon-connect");

    const result = await this.handshake(popup, requestId, () => {
      const req: ConnectRequestMessage = {
        __bt: PROTO_VERSION,
        type: "connect-request",
        requestId,
        origin: window.location.origin,
        appName: this.opts.appName,
      };
      popup.postMessage(req, this.walletOrigin);
    });

    if (result.type !== "connect-approved") {
      const reason = (result as { reason?: string }).reason ?? "User declined";
      throw new WalletAdapterError(reason, "CONNECT_REJECTED");
    }

    this.account = { address: result.address, chainId: result.chainId };
    return this.account;
  }

  disconnect(): void {
    this.account = null;
  }

  /** Sign an EVM transaction (returns 0x-hex signed serialized tx). */
  async signTransaction(transaction: TxRequest): Promise<string> {
    if (!this.connected)
      throw new WalletAdapterError("Wallet not connected", "NOT_CONNECTED");
    const result = await this.requestSign(transaction, "sign");
    return result.signedTransaction;
  }

  /** Sign and broadcast via the wallet's RPC. Returns the tx hash. */
  async signAndSendTransaction(
    transaction: TxRequest,
  ): Promise<{ txHash: string; signedTransaction: string }> {
    if (!this.connected)
      throw new WalletAdapterError("Wallet not connected", "NOT_CONNECTED");
    const result = await this.requestSign(transaction, "signAndSend");
    if (!result.txHash)
      throw new WalletAdapterError("Wallet did not return a tx hash", "NO_TX_HASH");
    return { txHash: result.txHash, signedTransaction: result.signedTransaction };
  }

  private async requestSign(transaction: TxRequest, mode: "sign" | "signAndSend") {
    const requestId = newRequestId();
    const popup = this.openPopup(`${this.opts.walletUrl}/sign`, "premon-sign");

    const result = await this.handshake(popup, requestId, () => {
      const req: SignRequestMessage = {
        __bt: PROTO_VERSION,
        type: "sign-request",
        requestId,
        origin: window.location.origin,
        appName: this.opts.appName,
        transaction,
        mode,
      };
      popup.postMessage(req, this.walletOrigin);
    });

    if (result.type === "sign-approved") return result;
    const reason = (result as { reason?: string }).reason ?? "User cancelled";
    throw new WalletAdapterError(reason, "SIGN_REJECTED");
  }

  /* ────────────── internals ────────────── */

  private openPopup(url: string, name: string): Window {
    const popup = window.open(url, name, this.opts.popupFeatures ?? DEFAULT_FEATURES);
    if (!popup) {
      throw new WalletAdapterError(
        "Popup blocked by browser. Allow popups for this site to use Premon.",
        "POPUP_BLOCKED",
      );
    }
    popup.focus();
    return popup;
  }

  private handshake(
    popup: Window,
    requestId: string,
    sendRequest: () => void,
  ): Promise<PopupOutgoing> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        try {
          popup.close();
        } catch {
          /* ignore */
        }
        reject(new WalletAdapterError("Wallet popup timed out", "TIMEOUT"));
      }, this.opts.timeoutMs ?? DEFAULT_TIMEOUT);

      const closedTimer = window.setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new WalletAdapterError("User closed wallet popup", "POPUP_CLOSED"));
        }
      }, 400);

      const listener: Listener = (raw: PopupOutgoing) => {
        if (raw.requestId !== requestId) return;
        cleanup();
        try {
          popup.close();
        } catch {
          /* ignore */
        }
        resolve(raw);
      };

      const handleMessage = (ev: MessageEvent) => {
        if (ev.origin !== this.walletOrigin) return;
        if (!isProtoMessage(ev.data)) return;
        const msg = ev.data as PopupOutgoing;
        if (msg.requestId !== requestId) return;
        if (msg.type === "popup-ready") {
          sendRequest();
          return;
        }
        listener(msg);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(closedTimer);
        window.removeEventListener("message", handleMessage);
      };

      window.addEventListener("message", handleMessage);
    });
  }
}
