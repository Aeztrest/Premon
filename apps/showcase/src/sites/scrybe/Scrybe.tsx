/**
 * Scrybe — pay-per-question oracle, x402 over Monad testnet.
 *
 * This is Premon's flagship demo. The page itself pays nothing: it just does a
 * plain `fetch` to the merchant. The merchant answers HTTP 402 with x402
 * PaymentRequirements, and the Premon BROWSER EXTENSION's x402 layer transparently
 * intercepts it, pays real USDC on-chain (under the user's x402 caps / auto-approve
 * setting), and retries with the `X-PAYMENT` header — so a successful fetch comes
 * back as a normal 200 with the answer.
 *
 * No session keys, no native MON, no dApp-side signing. Connecting a wallet is
 * optional: the extension pays from its own wallet regardless.
 */

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Sparkles, ShieldCheck, AlertTriangle,
  Loader2, Zap, ChevronDown, Lock, ShieldQuestion,
} from "lucide-react";
import { useWallet } from "../../wallet/context";

type Phase =
  | "asking"     // sent the fetch — extension may be settling x402 transparently
  | "answered"   // 200 + answer
  | "declined"   // 402 — extension didn't pay
  | "error";

interface AnswerEntry {
  id: string;
  question: string;
  phase: Phase;
  answer?: string;
  network?: string;
  txHash?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

const SUGGESTIONS = [
  "What is liquid staking?",
  "How does an AMM price swaps?",
  "What does an aggregator route?",
  "Explain USDC on Monad",
];

const DECLINE_MESSAGE =
  "Premon didn't authorize this payment — install/unlock the extension, or check your x402 settings (auto-approve + caps) in the wallet.";

export default function Scrybe() {
  const { connected, shortAddress, openWalletModal, disconnect } = useWallet();
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<AnswerEntry[]>([]);
  const [pending, setPending] = useState(false);

  async function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed || pending) return;
    void runQuestion(trimmed);
  }

  async function runQuestion(q: string) {
    setPending(true);
    setQuestion("");
    const entryId = `ask-${Date.now()}`;
    const entry: AnswerEntry = { id: entryId, question: q, phase: "asking", startedAt: Date.now() };
    setHistory((prev) => [...prev, entry]);
    const update = (patch: Partial<AnswerEntry>) =>
      setHistory((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...patch } : e)));

    try {
      // Plain fetch. If the Premon extension is installed + within caps, it pays
      // real USDC on-chain and transparently retries — so we just see a 200.
      const res = await fetch(`/api/demo/scrybe?q=${encodeURIComponent(q)}`, {
        headers: { accept: "application/json" },
      });

      if (res.status === 200) {
        const body = await res.json().catch(() => ({}));
        update({
          phase: "answered",
          answer: body.answer ?? "(empty answer)",
          network: body.network,
          txHash: body.txHash ?? undefined,
          finishedAt: Date.now(),
        });
        return;
      }

      if (res.status === 402) {
        // The extension didn't pay: not installed, locked, paused/revoked,
        // over cap, or the user declined the approval popup.
        update({ phase: "declined", error: DECLINE_MESSAGE, finishedAt: Date.now() });
        return;
      }

      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Server returned ${res.status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      update({ phase: "error", error: msg, finishedAt: Date.now() });
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submit(question);
  }

  return (
    <div className="min-h-screen text-ink-900 bg-paper">
      <Link to="/" className="fixed top-4 left-4 z-50 flex items-center gap-1.5 text-xs text-ink-900/40 hover:text-ink-900/80 transition-colors">
        <ArrowLeft size={12} /> Showcase
      </Link>

      <header className="border-b border-ink-900/10 sticky top-0 backdrop-blur-md z-30 bg-paper/85">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-ink-900">
              <Zap size={14} className="text-brand-500" />
            </div>
            <div>
              <h1 className="font-display font-bold tracking-tight">Scrybe</h1>
              <p className="text-[10px] text-ink-900/45 leading-none mt-0.5">Pay-per-question oracle</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {connected ? (
              <button
                onClick={() => void disconnect()}
                className="flex items-center gap-2 px-2.5 py-1 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-600/25"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {shortAddress}
              </button>
            ) : (
              <button
                onClick={openWalletModal}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-bone text-ink-900/70 border border-ink-900/12 hover:bg-ink-900/[0.04]"
              >
                <Lock size={10} /> Connect (optional)
              </button>
            )}
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-medium bg-brand-50 text-brand-700 border border-brand-500/20">
              <ShieldCheck size={10} /> Premon x402
            </span>
            <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-mono font-medium bg-bone text-ink-900/60 border border-ink-900/10">
              $0.001/q
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 pt-12 pb-32">
        {history.length === 0 && (
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-7">
            <div>
              <h2 className="font-display text-4xl sm:text-5xl font-black tracking-tight leading-[1.05]">
                Just ask.<br />
                <span className="text-brand-500">Premon pays.</span>
              </h2>
              <p className="text-ink-900/55 mt-3 leading-relaxed max-w-xl">
                Pay-per-question oracle over HTTP&nbsp;402 on Monad testnet. Each
                question costs 0.001&nbsp;USDC — but you never sign anything here.
                The Premon EXTENSION settles the x402 payment on-chain
                automatically, under your x402 caps. Flip <strong>x402
                auto-approve</strong> off in the wallet's Policies and the
                extension asks you to approve each payment instead.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void submit(s)}
                  disabled={pending}
                  className="text-left px-4 py-3.5 rounded-xl text-sm transition-all disabled:opacity-50 bg-paper border border-ink-900/10 shadow-card hover:border-brand-500/40 hover:shadow-lift"
                >
                  <span className="text-ink-900/80">{s}</span>
                </button>
              ))}
            </div>

            <HowItWorksDisclosure />
          </motion.section>
        )}

        <div className="space-y-5 mt-2">
          <AnimatePresence initial={false}>
            {history.map((entry) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <ConversationEntry entry={entry} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </main>

      <form
        onSubmit={onSubmit}
        className="fixed bottom-0 inset-x-0 border-t border-ink-900/10 backdrop-blur-md bg-paper/92"
      >
        <div className="max-w-3xl mx-auto px-6 py-3.5 flex items-center gap-3">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask Scrybe a question…"
            disabled={pending}
            className="flex-1 px-4 py-3 rounded-xl bg-bone border border-ink-900/12 text-ink-900 outline-none focus:border-brand-500/50 focus:bg-paper transition-all placeholder:text-ink-900/35 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={pending || !question.trim()}
            className="px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-30 transition-all flex items-center gap-2 text-white bg-ink-900 hover:bg-ink-800"
          >
            <Zap size={13} className="text-brand-500" /> Ask
          </button>
        </div>
      </form>
    </div>
  );
}

/* ───────── pieces ───────── */

function ConversationEntry({ entry }: { entry: AnswerEntry }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 justify-end">
        <p className="pt-1 rounded-2xl rounded-tr-sm bg-ink-900 text-white px-4 py-2.5 leading-relaxed max-w-[80%]">{entry.question}</p>
        <div className="w-7 h-7 rounded-full bg-ink-900/8 flex items-center justify-center text-[10px] text-ink-900/55 shrink-0">you</div>
      </div>

      {entry.phase === "asking" && <ProgressStep entry={entry} />}

      {entry.answer && (
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-ink-900">
            <Sparkles size={11} className="text-brand-500" />
          </div>
          <div className="flex-1">
            <p className="rounded-2xl rounded-tl-sm bg-bone text-ink-900 px-4 py-2.5 leading-relaxed">{entry.answer}</p>
            <SettlementReceipt
              network={entry.network}
              txHash={entry.txHash}
              elapsedMs={(entry.finishedAt ?? Date.now()) - entry.startedAt}
            />
          </div>
        </div>
      )}

      {entry.phase === "declined" && (
        <div className="ml-10 flex items-start gap-2 text-sm rounded-lg p-3 bg-bone border border-ink-900/12">
          <ShieldQuestion size={14} className="mt-0.5 shrink-0 text-ink-900/55" />
          <span className="text-ink-900/70">{entry.error}</span>
        </div>
      )}

      {entry.phase === "error" && (
        <div className="ml-10 flex items-start gap-2 text-sm rounded-lg p-3"
             style={{ background: "rgba(232,71,10,0.08)", border: "1px solid rgba(232,71,10,0.22)" }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "#E8470A" }} />
          <span style={{ color: "#E8470A" }}>{entry.error}</span>
        </div>
      )}
    </div>
  );
}

function ProgressStep({ entry: _entry }: { entry: AnswerEntry }) {
  const PHASES = [
    { key: "ask",    label: "Asking" },
    { key: "settle", label: "Premon settling x402" },
    { key: "answer", label: "Answered" },
  ];
  // Everything happens inside one transparent fetch, so we surface the middle
  // step as the active one while we wait.
  const idx = 1;

  return (
    <div className="ml-10 rounded-lg p-3 space-y-1.5 bg-bone border border-ink-900/10">
      {PHASES.map((p, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={p.key} className="flex items-center gap-2.5 text-xs">
            <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: done ? "rgba(5,150,105,0.14)" : active ? "rgba(255,107,0,0.14)" : "rgba(20,20,20,0.06)",
                  }}>
              {done ? <span className="text-[9px] text-emerald-600">✓</span>
                : active ? <Loader2 size={9} className="animate-spin" style={{ color: "#FF6B00" }} />
                : <span className="text-[8px] text-ink-900/35">{i + 1}</span>}
            </span>
            <span style={{
              color: active ? "rgba(20,20,20,0.92)" : done ? "rgba(20,20,20,0.55)" : "rgba(20,20,20,0.35)",
              fontWeight: active ? 600 : 400,
            }}>
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SettlementReceipt({ network, txHash, elapsedMs }: {
  network?: string; txHash?: string; elapsedMs: number;
}) {
  const explorerTx = txHash
    ? `https://testnet.monadexplorer.com/tx/${txHash}`
    : null;
  return (
    <div className="mt-3 rounded-xl p-3 text-xs flex items-start gap-2 bg-emerald-50 border border-emerald-600/20">
      <ShieldCheck size={14} className="text-emerald-600 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-emerald-700 font-medium mb-1">
          Paid via Premon x402 · {network ?? "monad"} · {(elapsedMs / 1000).toFixed(1)}s
        </p>
        {explorerTx ? (
          <a
            href={explorerTx}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-emerald-700 underline font-mono break-all mt-0.5 inline-block"
          >
            tx {txHash!.slice(0, 12)}… ↗
          </a>
        ) : (
          <p className="text-[10px] text-ink-900/40 mt-1">
            Settled on-chain by the extension under your x402 caps.
          </p>
        )}
      </div>
    </div>
  );
}

function HowItWorksDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-paper border border-ink-900/10 shadow-card">
      <button
        onClick={() => setOpen((s) => !s)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-ink-900/[0.02] rounded-xl"
      >
        <span className="text-xs uppercase tracking-wider text-ink-900/50 font-semibold">How it works</span>
        <ChevronDown size={12} className={`text-ink-900/35 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {[
            { n: "01", t: "Ask",     b: "Page does a plain fetch" },
            { n: "02", t: "402",     b: "Server demands 0.001 USDC" },
            { n: "03", t: "Premon",  b: "Extension pays USDC on-chain" },
            { n: "04", t: "Answer",  b: "Retried fetch returns 200" },
          ].map((s) => (
            <div key={s.n} className="rounded-lg p-2.5 bg-bone border border-ink-900/8">
              <p className="text-[9px] text-brand-700 font-mono">{s.n}</p>
              <p className="text-[12px] font-bold mt-0.5 text-ink-900">{s.t}</p>
              <p className="text-[10px] text-ink-900/50 mt-0.5 leading-snug">{s.b}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
