/**
 * Premon EIP-1193 provider (page MAIN world).
 *
 * Installs `window.ethereum` and announces via EIP-6963 so EVM dApps and
 * wallet pickers discover Premon automatically. State-changing methods are
 * forwarded to the background service worker through the content-script bridge;
 * read-only JSON-RPC is proxied directly to the Monad RPC endpoint.
 */

import { callPageBridge } from "./page-bridge";

const DEFAULT_RPC_URL = "https://testnet-rpc.monad.xyz";
const DEFAULT_CHAIN_ID_HEX = "0x279f"; // 10143

interface RequestArgs {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

type ProviderEvent =
  | "connect"
  | "disconnect"
  | "accountsChanged"
  | "chainChanged"
  | "message";

const ICON_DATA_URL = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <rect width="24" height="24" rx="6" fill="#836EF9"/>
    <path d="M12 5L18 18H6Z" fill="#141414"/>
    <rect x="4" y="19" width="16" height="1.6" rx="0.8" fill="#141414"/>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
})();

class PremonProvider {
  public readonly isPremon = true;
  /** Some dApps gate features on this flag; we are EIP-1193 compatible. */
  public readonly isMetaMask = false;
  private listeners = new Map<ProviderEvent, Set<(...args: unknown[]) => void>>();
  private cachedChainId = DEFAULT_CHAIN_ID_HEX;

  async request(args: RequestArgs): Promise<unknown> {
    const method = args.method;
    const params = (Array.isArray(args.params) ? args.params : []) as unknown[];
    const origin = window.location.origin;

    switch (method) {
      case "eth_requestAccounts": {
        const r = await callPageBridge<{ accounts: string[] }>("eth_requestAccounts", { origin });
        this.emit("accountsChanged", r.accounts);
        this.emit("connect", { chainId: this.cachedChainId });
        return r.accounts;
      }
      case "eth_accounts": {
        const r = await callPageBridge<{ accounts: string[] }>("eth_accounts", { origin });
        return r.accounts;
      }
      case "eth_chainId": {
        const r = await callPageBridge<{ chainId: string }>("eth_chainId", { origin });
        this.cachedChainId = r.chainId;
        return r.chainId;
      }
      case "net_version": {
        const r = await callPageBridge<{ chainId: string }>("eth_chainId", { origin });
        return String(Number.parseInt(r.chainId, 16));
      }
      case "wallet_switchEthereumChain": {
        const first = (params[0] ?? {}) as { chainId?: string };
        const chainId = first.chainId ?? DEFAULT_CHAIN_ID_HEX;
        await callPageBridge<{ ok: true }>("wallet_switchEthereumChain", { origin, chainId });
        this.cachedChainId = chainId;
        this.emit("chainChanged", chainId);
        return null;
      }
      case "personal_sign": {
        const { message, address } = decodePersonalSign(params);
        const r = await callPageBridge<{ signature: string }>("personal_sign", { origin, message, address });
        return r.signature;
      }
      case "eth_sign": {
        // Treat as personal_sign: [address, message]
        const address = String(params[0] ?? "");
        const message = String(params[1] ?? "");
        const r = await callPageBridge<{ signature: string }>("personal_sign", { origin, message, address });
        return r.signature;
      }
      case "eth_signTypedData_v4": {
        const address = String(params[0] ?? "");
        const raw = params[1];
        const typedData = typeof raw === "string" ? raw : JSON.stringify(raw);
        const r = await callPageBridge<{ signature: string }>("eth_signTypedData_v4", { origin, address, typedData });
        return r.signature;
      }
      case "eth_sendTransaction": {
        const transaction = params[0] ?? {};
        const r = await callPageBridge<{ txHash: string }>("eth_sendTransaction", { origin, transaction });
        return r.txHash;
      }
      case "eth_signTransaction": {
        const transaction = params[0] ?? {};
        const r = await callPageBridge<{ signedTransaction: string }>("eth_signTransaction", { origin, transaction });
        return r.signedTransaction;
      }
      default:
        // Read-only JSON-RPC — proxy directly to the Monad endpoint.
        return rpcProxy(method, params);
    }
  }

  /* Legacy convenience wrappers some libraries still call. */
  async enable(): Promise<string[]> {
    return this.request({ method: "eth_requestAccounts" }) as Promise<string[]>;
  }

  on(event: ProviderEvent, handler: (...args: unknown[]) => void): this {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(handler);
    return this;
  }

  removeListener(event: ProviderEvent, handler: (...args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  private emit(event: ProviderEvent, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(...args); } catch { /* ignore listener errors */ }
    }
  }
}

function decodePersonalSign(params: unknown[]): { message: string; address: string } {
  const a = String(params[0] ?? "");
  const b = String(params[1] ?? "");
  // Spec order is [message, address], but some dApps send [address, message].
  const aIsAddr = /^0x[0-9a-fA-F]{40}$/.test(a);
  if (aIsAddr) return { message: b, address: a };
  return { message: a, address: b };
}

async function rpcProxy(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(DEFAULT_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? `RPC error for ${method}`);
  return json.result;
}

export function installEip1193Provider(): void {
  const provider = new PremonProvider();

  try {
    Object.defineProperty(window, "ethereum", {
      value: provider,
      writable: false,
      configurable: true,
    });
  } catch {
    // Another wallet locked window.ethereum — EIP-6963 still lets dApps find us.
    (window as unknown as { ethereum?: unknown }).ethereum ??= provider;
  }

  const info = {
    uuid: "b5e1d4f0-premonmon-4a2b-9c1d-premon0000001",
    name: "Premon",
    icon: ICON_DATA_URL,
    rdns: "dev.premon.wallet",
  };

  const announce = () => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider }),
      }),
    );
  };

  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}
