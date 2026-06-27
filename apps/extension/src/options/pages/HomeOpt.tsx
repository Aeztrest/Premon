/**
 * Options home dashboard (Monad build).
 *
 * Live-polls the EOA wallet balance every 8 seconds and surfaces it in the
 * hero. Single EOA wallet — the connected account IS the wallet.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatEther } from "ethers";
import {
  Send,
  Download,
  Shield,
  Clock,
  ArrowRight,
} from "lucide-react";
import { useRpc, useWalletState } from "../../shared/state-context";
import type { GuardPolicy } from "@premon/guard";
import {
  OptionsSendModal,
  OptionsReceiveModal,
} from "../components/SendReceiveModal";

export function HomeOpt() {
  const state = useWalletState();
  const rpc = useRpc();
  const [balance, setBalance] = useState<number | null>(null);
  const [policy, setPolicy] = useState<GuardPolicy | null>(null);
  const [overlay, setOverlay] = useState<"send" | "receive" | null>(null);

  const refresh = useCallback(async () => {
    if (!state?.address) {
      setBalance(null);
      return;
    }
    try {
      const r = await rpc.call("wallet.balance", { address: state.address });
      setBalance(Number(formatEther(r.wei)));
    } catch {
      /* ignore — UI shows last known */
    }
  }, [state, rpc]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    void rpc
      .call("policy.read", undefined as never)
      .then((p) => setPolicy(p as GuardPolicy));
  }, [rpc]);

  if (!state) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Welcome back</h1>
        <p className="text-text-muted text-sm mt-1">
          Your wallet is live on {state.network}. Every transaction passes
          Premon before signing.
        </p>
      </div>

      <section
        className="rounded-card p-6 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,107,0,0.08), rgba(255,107,0,0.015))",
          border: "1px solid var(--line)",
        }}
      >
        <p className="label">
          Wallet · {shortAddr(state.address)}
        </p>
        <p className="text-5xl font-extrabold leading-none font-mono tracking-tight">
          {balance === null ? "—" : balance.toFixed(4)}
          <span className="text-2xl text-text-faint font-bold ml-2">MON</span>
        </p>
        <p className="text-text-faint text-xs mt-2">
          {balance && balance > 0
            ? "Funds available in your wallet."
            : "Wallet empty — receive MON to get started."}
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setOverlay("send")}>
            <Send size={13} /> Send
          </button>
          <button className="btn-ghost" onClick={() => setOverlay("receive")}>
            <Download size={13} /> Receive
          </button>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <Link to="/policies" className="card hover:bg-black/[0.03] transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Shield size={14} className="text-accent-soft" />
              <h2 className="font-bold text-sm">Active policy</h2>
            </div>
            <ArrowRight size={13} className="text-text-faint" />
          </div>
          <PolicySummary policy={policy} />
        </Link>

        <Link to="/sites" className="card hover:bg-black/[0.03] transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-accent-soft" />
              <h2 className="font-bold text-sm">Connected sites</h2>
            </div>
            <ArrowRight size={13} className="text-text-faint" />
          </div>
          <p className="text-text-faint text-xs leading-relaxed">
            Every dApp you connect, every x402 paywall you visit. Per-origin
            caps, pause, revoke.
          </p>
        </Link>
      </div>

      {overlay === "send" && state.address && (
        <OptionsSendModal
          address={state.address}
          network={state.network}
          balanceMon={balance}
          onClose={() => setOverlay(null)}
          onSent={refresh}
        />
      )}
      {overlay === "receive" && state.address && (
        <OptionsReceiveModal
          address={state.address}
          network={state.network}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  );
}

function PolicySummary({ policy }: { policy: GuardPolicy | null }) {
  if (!policy) return <p className="text-xs text-text-faint">Loading…</p>;
  const rows: Array<[string, string]> = [
    [
      "Max loss per tx",
      policy.maxLossPercent != null ? `${policy.maxLossPercent}%` : "—",
    ],
    ["Block risky contracts", policy.blockRiskyContracts ? "On" : "Off"],
    ["Block unlimited approvals", policy.blockUnlimitedApprovals ? "On" : "Off"],
    [
      "Require successful simulation",
      policy.requireSuccessfulSimulation !== false ? "Yes" : "No",
    ],
    [
      "x402 hourly cap",
      policy.x402HourlyCap != null
        ? `$${policy.x402HourlyCap.toFixed(2)}`
        : "—",
    ],
  ];
  return (
    <ul className="space-y-1.5 text-xs">
      {rows.map(([label, value]) => (
        <li key={label} className="flex justify-between">
          <span className="text-text-faint">{label}</span>
          <span className="font-medium">{value}</span>
        </li>
      ))}
    </ul>
  );
}

function shortAddr(s: string | null): string {
  if (!s) return "—";
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}
