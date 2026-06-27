/**
 * Popup home tab (Monad build).
 *
 * Send/Receive open as full-popup overlays. The hero shows native MON +
 * USDC balances fetched from the background.
 */

import { useCallback, useEffect, useState } from "react";
import { Send, Download, Droplet, ChevronRight } from "lucide-react";
import { formatEther } from "ethers";
import { useRpc, useWalletState } from "../shared/state-context";
import { chainFor } from "../shared/chain";
import { ReceiveScreen } from "./ReceiveScreen";
import { SendScreen } from "./SendScreen";
import { TokenDetail } from "./TokenDetail";

export function Home() {
  const state = useWalletState();
  const rpc = useRpc();
  const [balance, setBalance] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [overlay, setOverlay] = useState<"send" | "receive" | "token" | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!state?.address) return;
    try {
      const r = await rpc.call("wallet.balance", { address: state.address });
      setBalance(Number(formatEther(r.wei)));
      setUsdc(r.usdc === null ? null : Number(r.usdc));
    } catch {
      /* keep last value */
    }
  }, [state?.address, rpc]);

  useEffect(() => {
    let cancelled = false;
    void refreshBalance().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [refreshBalance]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 relative">
      <section
        className="rounded-card p-5 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgba(131, 110, 249,0.08), rgba(131, 110, 249,0.015))",
          border: "1px solid var(--line)",
        }}
      >
        <p className="label mb-3">Wallet</p>

        <div className="flex flex-col">
          <BalanceRow
            asset="MON"
            hint="network fees"
            value={balance === null ? "—" : balance.toFixed(4)}
          />
          <div style={{ borderTop: "1px solid var(--line)" }} />
          <BalanceRow
            asset="USDC"
            hint="tap for contract + QR"
            value={usdc === null ? "0.0000" : usdc.toFixed(4)}
            onClick={() => setOverlay("token")}
          />
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <ActionButton
            icon={Send}
            label="Send"
            onClick={() => setOverlay("send")}
          />
          <ActionButton
            icon={Download}
            label="Receive"
            onClick={() => setOverlay("receive")}
          />
          <ActionButton
            icon={Droplet}
            label="Faucet"
            onClick={
              state?.network && chainFor(state.network).faucetUrl
                ? () => window.open(chainFor(state.network).faucetUrl, "_blank", "noopener")
                : undefined
            }
          />
        </div>
      </section>

      <section className="card flex-1 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="label !mb-0">Recent activity</p>
          <span className="text-[10px] text-text-faint">live in T26</span>
        </div>
        <p className="text-xs text-text-faint">
          Your transactions, dApp signatures, and x402 payments will live here
          once the allowance ledger is online.
        </p>
      </section>

      {overlay === "receive" && state?.address && (
        <ReceiveScreen
          address={state.address}
          network={state.network}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === "send" && state?.address && (
        <SendScreen
          address={state.address}
          network={state.network}
          balanceMon={balance}
          onClose={() => setOverlay(null)}
          onSent={refreshBalance}
        />
      )}
      {overlay === "token" && state?.network && (
        <TokenDetail
          symbol="USDC"
          tokenAddress={chainFor(state.network).usdcAddress}
          balance={usdc === null ? "0.0000" : usdc.toFixed(4)}
          network={state.network}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  );
}

function BalanceRow({
  asset,
  hint,
  value,
  warn,
  onClick,
}: {
  asset: string;
  hint: string;
  value: string;
  warn?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="flex flex-col items-start">
        <span className="text-sm font-bold leading-none flex items-center gap-1">
          {asset}
          {onClick && <ChevronRight size={12} className="text-text-faint" />}
        </span>
        <span className="text-text-faint text-[10px] mt-1">{hint}</span>
      </div>
      <span
        className="text-2xl font-extrabold font-mono tracking-tight leading-none"
        style={warn ? { color: "var(--text-faint)" } : undefined}
      >
        {value}
      </span>
    </>
  );
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="flex items-baseline justify-between py-2.5 -mx-2 px-2 rounded-input hover:bg-black/[0.04] transition-colors text-left w-[calc(100%+1rem)]"
      >
        {inner}
      </button>
    );
  }
  return <div className="flex items-baseline justify-between py-2.5">{inner}</div>;
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Send;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="flex flex-col items-center gap-1 py-2.5 rounded-input transition-all
                 hover:bg-black/[0.06] disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: "rgba(20,20,20,0.03)",
        border: "1px solid var(--line)",
      }}
    >
      <Icon size={14} className="text-text" />
      <span className="text-[10px] font-semibold uppercase tracking-wider">
        {label}
      </span>
    </button>
  );
}
