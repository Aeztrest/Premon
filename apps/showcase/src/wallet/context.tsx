/**
 * Showcase wallet context (Monad / EVM build).
 *
 * Discovers EVM wallet providers reachable from the page — Premon (popup via
 * `@premon/wallet-adapter`) and any injected EIP-1193 wallet — and exposes
 * the adapter shape the existing sites consume.
 *
 * Design rules:
 *  - `connect(provider)` ALWAYS requires an explicit provider. We never auto-
 *    pick from the list — that's how malicious wallets hijack the flow.
 *  - When a site action ("Swap", "Mint", etc.) needs a wallet, the site calls
 *    `openWalletModal()` — the user explicitly picks Premon from the picker.
 *  - The wallet modal renders ONCE inside the provider so every route shares
 *    the same picker state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  discoverEvmProviders,
  WalletStandardBridge,
  WalletStandardBridgeError,
  type EvmWalletProvider,
  type TxRequest,
} from "./standard-bridge";
import { WalletModal } from "./WalletModal";

export interface WalletState {
  /** Wallet providers reachable from the page. */
  available: EvmWalletProvider[];
  /** True if a wallet is connected. */
  connected: boolean;
  /** Connected EOA address (`0x…`). */
  walletAddress: string | null;
  shortAddress: string | null;
  /** Active chain id, e.g. 10143 for Monad testnet. */
  chainId: number | null;
  connecting: boolean;
  openWalletModal: () => void;
  connect: (
    provider: EvmWalletProvider,
  ) => Promise<WalletStandardBridge | null>;
  disconnect: () => Promise<void>;
  /** Adapter shape the showcase sites consume. */
  adapter: {
    signAndSendTransaction: (
      tx: TxRequest,
    ) => Promise<{ signature: string; signedTxXdr: string }>;
    signTransaction: (tx: TxRequest) => Promise<{ signedTransaction: string }>;
  };
  appName: string;
}

const Ctx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside <WalletProvider>");
  return v;
}

export function WalletProvider({
  appName,
  children,
}: {
  appName: string;
  children: ReactNode;
}) {
  // Providers are discovered synchronously from page globals; the list is
  // stable across renders so we compute it once.
  const [available] = useState<EvmWalletProvider[]>(() =>
    discoverEvmProviders(),
  );
  const [bridge, setBridge] = useState<WalletStandardBridge | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const connect = useCallback(
    async (
      provider: EvmWalletProvider,
    ): Promise<WalletStandardBridge | null> => {
      if (!provider) return null;
      setConnecting(true);
      try {
        const b = await WalletStandardBridge.connect(provider);
        setBridge(b);
        setModalOpen(false);
        return b;
      } catch (err) {
        if (!(err instanceof WalletStandardBridgeError)) console.error(err);
        return null;
      } finally {
        setConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async () => {
    if (bridge) await bridge.disconnect().catch(() => {});
    setBridge(null);
  }, [bridge]);

  const openWalletModal = useCallback(() => {
    setModalOpen(true);
  }, []);
  const closeWalletModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  const adapter = useMemo(
    () => ({
      signAndSendTransaction: async (tx: TxRequest) => {
        if (!bridge)
          throw new WalletStandardBridgeError(
            "No wallet connected",
            "NOT_CONNECTED",
          );
        return bridge.signAndSendTransaction(tx);
      },
      signTransaction: async (tx: TxRequest) => {
        if (!bridge)
          throw new WalletStandardBridgeError(
            "No wallet connected",
            "NOT_CONNECTED",
          );
        return bridge.signTransaction(tx);
      },
    }),
    [bridge],
  );

  const walletAddress = bridge?.account_pubkey() ?? null;
  const value = useMemo<WalletState>(
    () => ({
      available,
      connected: !!bridge,
      walletAddress,
      shortAddress: walletAddress ? short(walletAddress) : null,
      chainId: bridge?.chainId ?? null,
      connecting,
      openWalletModal,
      connect,
      disconnect,
      adapter,
      appName,
    }),
    [
      available,
      bridge,
      walletAddress,
      connecting,
      openWalletModal,
      connect,
      disconnect,
      adapter,
      appName,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <WalletModal
        open={modalOpen}
        onClose={closeWalletModal}
        onConnect={(p) => {
          void connect(p);
        }}
        connecting={connecting}
        available={available}
      />
    </Ctx.Provider>
  );
}

function short(s: string): string {
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
