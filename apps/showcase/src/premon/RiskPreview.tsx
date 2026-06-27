/**
 * RiskPreview — pre-sign analysis overlay rendered ON THE SITE before the
 * wallet popup opens. Calls Premon's analyze server (via `@premon/guard`)
 * with the candidate transaction, surfaces the verdict + reasons + balance
 * deltas + findings, and lets the user decide:
 *
 *   - "Sign with Premon" → the existing wallet flow (the wallet popup runs the
 *     same analysis a second time as the authoritative gatekeeper).
 *   - "Send without protection" → bypasses Premon's site-side review and signs
 *     through the connected wallet. Lets visitors viscerally compare a guarded
 *     site vs a vanilla one.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatEther, formatUnits } from "ethers";
import {
  ShieldCheck, ShieldX, AlertTriangle, X, Loader2, Zap, EyeOff,
  ArrowDownRight, ArrowUpRight, HardHat,
} from "lucide-react";
import type { TxRequest } from "@premon/wallet-adapter";
import {
  analyzeTransactionForPreview,
  type PreviewResult,
  type RiskFinding,
} from "./analyze";

interface Props {
  open: boolean;
  /** Unsigned EVM transaction request. */
  transaction: TxRequest | null;
  userWallet: string | null;
  scenarioLabel: string;
  onClose: () => void;
  onProceedWithPremon: () => void | Promise<void>;
  onProceedRaw: () => void | Promise<void>;
}

export function RiskPreview({
  open, transaction, userWallet, scenarioLabel,
  onClose, onProceedWithPremon, onProceedRaw,
}: Props) {
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !transaction || !userWallet) return;
    let cancelled = false;
    setResult(null); setError(null); setLoading(true);
    analyzeTransactionForPreview(transaction, userWallet)
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, transaction, userWallet]);

  const verdict = result?.decision ?? "safe";
  const blocked = verdict === "block";
  const advisory = verdict === "advisory";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(20,20,20,0.45)", backdropFilter: "blur(8px)" }}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 12 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl overflow-hidden bg-white shadow-lift"
            style={{ border: "1px solid rgba(20,20,20,0.10)" }}
          >
            <div className="hazard h-1" aria-hidden />
            <header className="px-5 py-4 border-b border-ink-900/8 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-ink-600">
                <HardHat size={13} className="text-brand-500" />
                <span className="uppercase tracking-wider font-bold">Premon pre-sign</span>
              </div>
              <button onClick={onClose} className="text-ink-300 hover:text-ink-700">
                <X size={16} />
              </button>
            </header>

            <div className="px-5 pt-4 pb-2">
              <p className="text-[10px] uppercase tracking-wider text-ink-400 font-bold">Action</p>
              <p className="text-sm text-ink-800 mt-0.5 mb-3">{scenarioLabel}</p>
            </div>

            <div className="px-5 pb-3 space-y-3">
              {loading && (
                <div className="rounded-xl p-4 flex items-center gap-2.5 text-sm text-ink-500"
                     style={{ background: "rgba(20,20,20,0.03)", border: "1px solid rgba(20,20,20,0.08)" }}>
                  <Loader2 size={14} className="animate-spin text-brand-500" />
                  Simulating + running 25+ risk detectors…
                </div>
              )}

              {error && (
                <div className="rounded-xl p-3 text-xs flex items-start gap-2"
                     style={{ background: "rgba(255,107,0,0.07)", color: "#C24E02", border: "1px solid rgba(255,107,0,0.35)" }}>
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold mb-0.5">Analyze server unreachable</p>
                    <p className="text-ink-500 text-[11px] break-all">{error}</p>
                  </div>
                </div>
              )}

              {result && <Verdict result={result} />}
              {result && <Changes result={result} />}
              {result && <Findings findings={result.analysis.riskFindings} />}
            </div>

            <footer className="px-5 py-4 border-t border-ink-900/8 bg-bone space-y-2">
              <CompareBar verdict={verdict} loading={loading} />

              <div className="flex gap-2">
                <button
                  onClick={() => { void onProceedRaw(); }}
                  className="flex-1 px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 text-ink-600"
                  style={{ background: "#fff", border: "1px solid rgba(20,20,20,0.14)" }}
                  title="Bypass Premon — sign + send without firewall"
                >
                  <EyeOff size={11} /> Send without protection
                </button>
                <button
                  onClick={() => { void onProceedWithPremon(); }}
                  disabled={loading}
                  className="flex-1 px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                  style={{
                    background: blocked ? "rgba(255,107,0,0.12)" : advisory ? "rgba(255,136,56,0.14)" : "#141414",
                    color: blocked ? "#C24E02" : advisory ? "#993E06" : "#fff",
                    border: blocked ? "1px solid rgba(255,107,0,0.45)" : advisory ? "1px solid rgba(255,136,56,0.45)" : "1px solid #141414",
                  }}
                >
                  <Zap size={11} className={blocked || advisory ? "" : "text-brand-400"} />
                  {blocked ? "Sign anyway with Premon" : "Sign with Premon"}
                </button>
              </div>
              <p className="text-[10px] text-ink-400 leading-snug px-1">
                "Sign with Premon" routes through the wallet popup, where the same
                checks fire as the wallet's authoritative gatekeeper. "Without
                protection" sends directly through the wallet, no firewall — shown
                for demo comparison only.
              </p>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ──────────────── verdict hero ──────────────── */

function Verdict({ result }: { result: PreviewResult }) {
  const decision = result.decision;
  const tone =
    decision === "block"    ? { bg: "rgba(255,107,0,0.08)",  border: "rgba(255,107,0,0.45)",  color: "#C24E02", label: "BLOCKED by your policy", Icon: ShieldX }
  : decision === "advisory" ? { bg: "rgba(255,136,56,0.08)", border: "rgba(255,136,56,0.40)", color: "#993E06", label: "Sign with caution",       Icon: AlertTriangle }
                            : { bg: "rgba(16,185,129,0.07)", border: "rgba(16,185,129,0.35)", color: "#059669", label: "Safe to sign",             Icon: ShieldCheck };
  const Icon = tone.Icon;
  const reasons = result.analysis.reasons;
  return (
    <div className="rounded-xl p-3.5 flex gap-3"
         style={{ background: tone.bg, border: `1px solid ${tone.border}` }}>
      <Icon size={20} className="shrink-0 mt-0.5" style={{ color: tone.color }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: tone.color }}>{tone.label}</p>
        {reasons.length > 0 && (
          <ul className="text-[11px] text-ink-600 mt-1 space-y-0.5">
            {reasons.slice(0, 3).map((r, i) => (
              <li key={i} className="leading-snug">· {r}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Changes({ result }: { result: PreviewResult }) {
  const changes = result.analysis.estimatedChanges;
  const native = changes.native.filter(
    (n) => n.deltaWei !== null && n.deltaWei !== "0",
  );
  const assets = changes.assets;
  const approvals = changes.approvals;
  if (!native.length && !assets.length && !approvals.length) return null;

  return (
    <div className="rounded-xl p-3"
         style={{ background: "rgba(20,20,20,0.03)", border: "1px solid rgba(20,20,20,0.08)" }}>
      <p className="text-[10px] uppercase tracking-wider text-ink-400 font-bold mb-2">What changes</p>
      <div className="space-y-1.5 text-[11px]">
        {native.map((n, i) => (
          <DeltaRow key={`mon-${i}`}
            label={shortAddr(n.accountId)}
            value={formatMonDelta(n.deltaWei!)}
            negative={(n.deltaWei ?? "0").startsWith("-")}
          />
        ))}
        {assets.map((a, i) => (
          <DeltaRow key={`asset-${i}`}
            label={a.assetCode || shortAddr(a.asset)}
            value={formatTokenDelta(a.delta, a.decimals, a.assetCode)}
            negative={a.delta.startsWith("-")}
          />
        ))}
        {approvals.map((ap, i) => (
          <DeltaRow key={`approve-${i}`}
            label={`Approve ${ap.tokenSymbol || shortAddr(ap.tokenAddress)} → ${shortAddr(ap.spender)}`}
            value={ap.unlimited ? "UNLIMITED" : ap.amount}
            warn
          />
        ))}
      </div>
    </div>
  );
}

function formatMonDelta(deltaWei: string): string {
  const negative = deltaWei.startsWith("-");
  const abs = negative ? deltaWei.slice(1) : deltaWei;
  try {
    const mon = formatEther(BigInt(abs));
    return `${negative ? "-" : "+"}${trimDecimals(mon)} MON`;
  } catch {
    return `${negative ? "-" : "+"}${abs} wei`;
  }
}

function formatTokenDelta(delta: string, decimals: number, code: string): string {
  const negative = delta.startsWith("-");
  const abs = negative ? delta.slice(1) : delta;
  try {
    const amount = formatUnits(BigInt(abs), decimals);
    return `${negative ? "-" : "+"}${trimDecimals(amount)} ${code}`.trim();
  } catch {
    return delta;
  }
}

function trimDecimals(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "");
}

function DeltaRow({ label, value, negative, warn }: {
  label: string; value: string; negative?: boolean; warn?: boolean;
}) {
  const color = warn ? "#993E06" : negative ? "#C24E02" : "#059669";
  const Arrow = negative ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-ink-500 truncate">{label}</span>
      <span className="font-mono shrink-0 flex items-center gap-1" style={{ color }}>
        <Arrow size={11} />{value}
      </span>
    </div>
  );
}

function Findings({ findings }: { findings: RiskFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <div className="rounded-xl p-3 space-y-1.5"
         style={{ background: "rgba(20,20,20,0.03)", border: "1px solid rgba(20,20,20,0.08)" }}>
      <p className="text-[10px] uppercase tracking-wider text-ink-400 font-bold">
        Findings ({findings.length})
      </p>
      {findings.map((f, i) => <FindingRow key={i} finding={f} />)}
    </div>
  );
}

function FindingRow({ finding }: { finding: RiskFinding }) {
  const tone =
    finding.severity === "critical" || finding.severity === "high" ? "#C24E02"
  : finding.severity === "medium"                                  ? "#993E06"
                                                                   : "#6B6862";
  return (
    <div className="rounded-lg px-2.5 py-2 flex items-start gap-2 bg-white"
         style={{ border: "1px solid rgba(20,20,20,0.07)" }}>
      <span className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ background: tone }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="font-mono text-[10px] font-semibold" style={{ color: tone }}>{finding.code}</span>
          <span className="text-[9px] uppercase tracking-wider font-bold px-1 py-px rounded"
                style={{ background: "rgba(20,20,20,0.06)", color: tone }}>
            {finding.severity}
          </span>
        </div>
        <p className="text-[11px] text-ink-600 mt-0.5 leading-relaxed">{finding.message}</p>
      </div>
    </div>
  );
}

function CompareBar({ verdict, loading }: { verdict: PreviewResult["decision"]; loading: boolean }) {
  if (loading) return null;
  const withMsg = verdict === "block" ? "blocks this tx" : verdict === "advisory" ? "warns + asks again" : "allows + audit";
  const withoutMsg = "no checks · signs immediately";
  return (
    <div className="grid grid-cols-2 gap-2 text-[10px]">
      <div className="rounded-lg p-2 flex flex-col bg-white"
           style={{ border: "1px solid rgba(20,20,20,0.08)" }}>
        <span className="text-ink-400 uppercase tracking-wider font-bold">Without Premon</span>
        <span className="text-ink-600 mt-0.5">{withoutMsg}</span>
      </div>
      <div className="rounded-lg p-2 flex flex-col"
           style={{ background: "rgba(255,107,0,0.07)", border: "1px solid rgba(255,107,0,0.35)" }}>
        <span className="text-brand-700 uppercase tracking-wider font-bold">With Premon</span>
        <span className="text-ink-900 font-semibold mt-0.5">{withMsg}</span>
      </div>
    </div>
  );
}

function shortAddr(s: string): string {
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
