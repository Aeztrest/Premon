/**
 * /agents — protect a program / AI-agent wallet with Premon.
 *
 * Explains the agent-wallet use case, shows the @premon/agent-kit SDK + CLI,
 * and provides a LIVE guard tester: pick an agent action + a policy, run it
 * through the deployed analyzer, and see whether Premon would allow or block —
 * the exact decision `GuardedWallet.sendTransaction` makes before signing.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { formatEther } from "ethers";
import {
  Bot, Terminal, ShieldCheck, ShieldX, ShieldAlert, Loader2, Play, KeyRound, Cpu,
} from "lucide-react";
import {
  BackdropGrid,
  LandingHeader,
  LandingFooter,
} from "../components/LandingChrome";
import { analyzeTransactionForPreview } from "../premon/analyze";
import { buildScenario, type ScenarioId } from "../premon/transactions";
import { STRICT_POLICY, BALANCED_POLICY, PERMISSIVE_POLICY, type GuardPolicy } from "@premon/guard";

type Preview = Awaited<ReturnType<typeof analyzeTransactionForPreview>>;

// A throwaway demo agent address (the "from" of the tested transactions).
const AGENT = "0xa9e0700000000000000000000000000000a9e070";

const POLICIES: Record<string, GuardPolicy> = {
  strict: STRICT_POLICY,
  balanced: BALANCED_POLICY,
  permissive: PERMISSIVE_POLICY,
};

const ACTIONS: { id: ScenarioId; label: string; sub: string }[] = [
  { id: "novaswap-danger", label: "Unlimited token approval", sub: "approve(spender, MAX) — classic drainer" },
  { id: "claimhub-danger", label: "Transfer to a flagged address", sub: "send funds to a known-malicious EOA" },
  { id: "pixeldrop-danger", label: "Grant NFT operator", sub: "setApprovalForAll(operator, true)" },
  { id: "orbityield-warn", label: "Deposit into unknown contract", sub: "call into an unverified contract" },
  { id: "novaswap-safe", label: "Normal small transfer", sub: "a benign 0.0001 MON transfer" },
];

const INSTALL = `pnpm add @premon/agent-kit`;

const SDK_SNIPPET = `import { GuardedWallet, STRICT_POLICY } from "@premon/agent-kit";

const agent = new GuardedWallet({
  privateKey: process.env.AGENT_KEY!,            // your agent's key
  rpcUrl:     "https://testnet-rpc.monad.xyz",
  analyzeUrl: "https://premon-api.onrender.com", // Premon firewall
  policy:     STRICT_POLICY,                      // your rules
});

// Premon simulates + policy-checks FIRST. If it blocks,
// this throws GuardBlockedError and never signs.
await agent.sendTransaction({ to: token, data: approveCalldata });`;

const CLI_SNIPPET = `export PREMON_PRIVATE_KEY=0xYOUR_AGENT_KEY

# dry-run: see the verdict, sign nothing
premon analyze --to 0xToken --data 0x095ea7b3… --policy strict

# guarded send: signs + broadcasts only if the policy allows
premon send    --to 0xToken --data 0x095ea7b3… --policy strict`;

export default function AgentsPage() {
  const [policyName, setPolicyName] = useState<string>("strict");
  const [action, setAction] = useState<ScenarioId>("novaswap-danger");
  const [result, setResult] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const built = await buildScenario(action, AGENT);
      const r = await analyzeTransactionForPreview(built.transaction, AGENT, POLICIES[policyName]);
      setResult(r);
    } catch {
      /* analyzeTransactionForPreview already returns a safe offline result */
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper text-ink-900">
      <LandingHeader cta={{ label: "Install CLI", to: "/install" }} />
      <BackdropGrid />

      <main className="relative max-w-5xl mx-auto px-6 pt-28 pb-24">
        {/* hero */}
        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-500/20">
            <Bot size={13} /> For programs & AI agents
          </div>
          <h1 className="mt-5 font-display text-4xl sm:text-5xl font-black tracking-tight leading-[1.05]">
            Give your agent a wallet<br />
            <span className="text-brand-500">it can't get drained from.</span>
          </h1>
          <p className="mt-4 text-ink-500 leading-relaxed">
            Agents sign transactions on their own — a poisoned prompt, a bad tool, or a
            malicious dependency shouldn't be able to drain them. Wrap the agent's signer
            with Premon: every transaction is simulated and policy-checked <em>before</em> it's
            signed, and anything that violates your rules is refused.
          </p>
        </motion.section>

        {/* how it works */}
        <section className="mt-14 grid sm:grid-cols-3 gap-3">
          {[
            { icon: KeyRound, t: "Wrap the key", b: "GuardedWallet takes your agent's private key + a policy." },
            { icon: Cpu, t: "Analyze first", b: "Each send is simulated by Premon and checked against the policy." },
            { icon: ShieldCheck, t: "Refuse or sign", b: "Blocked → throws, never signs. Allowed → broadcast as usual." },
          ].map((s) => (
            <div key={s.t} className="card p-5">
              <s.icon size={18} className="text-brand-600" />
              <p className="mt-3 font-bold text-ink-900">{s.t}</p>
              <p className="mt-1 text-sm text-ink-500 leading-relaxed">{s.b}</p>
            </div>
          ))}
        </section>

        {/* SDK + CLI */}
        <section className="mt-14 grid lg:grid-cols-2 gap-4">
          <CodeCard icon={Terminal} title="SDK — GuardedWallet" sub="Drop-in ethers signer">
            <CmdLine text={INSTALL} />
            <Code text={SDK_SNIPPET} />
          </CodeCard>
          <CodeCard icon={Terminal} title="CLI — premon" sub="Guard from the shell / CI / cron">
            <Code text={CLI_SNIPPET} />
          </CodeCard>
        </section>

        {/* live tester */}
        <section className="mt-14">
          <h2 className="font-display text-2xl font-bold tracking-tight">Try the guard, live</h2>
          <p className="text-ink-500 text-sm mt-1">
            Pick what the agent tries to do and the policy it runs under, then ask Premon.
            This hits the same analyzer <code className="text-brand-700">GuardedWallet</code> calls.
          </p>

          <div className="mt-5 card p-5 space-y-5">
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">Agent action</p>
                <div className="space-y-2 mt-1">
                  {ACTIONS.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setAction(a.id)}
                      className="w-full text-left px-3 py-2.5 rounded-xl border transition-all"
                      style={{
                        borderColor: action === a.id ? "rgba(131,110,249,0.5)" : "rgba(20,20,20,0.1)",
                        background: action === a.id ? "rgba(131,110,249,0.06)" : "transparent",
                      }}
                    >
                      <p className="text-sm font-semibold text-ink-900">{a.label}</p>
                      <p className="text-[11px] text-ink-400 font-mono">{a.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">Policy</p>
                <div className="flex gap-2 mt-1">
                  {Object.keys(POLICIES).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPolicyName(p)}
                      className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold capitalize border transition-all"
                      style={{
                        borderColor: policyName === p ? "rgba(131,110,249,0.5)" : "rgba(20,20,20,0.1)",
                        background: policyName === p ? "rgba(131,110,249,0.06)" : "transparent",
                        color: policyName === p ? "#5B40D6" : "rgba(20,20,20,0.6)",
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => void run()}
                  disabled={loading}
                  className="btn-primary w-full mt-4 disabled:opacity-60"
                >
                  {loading ? <><Loader2 size={14} className="animate-spin" /> Asking Premon…</> : <><Play size={14} /> Run guard</>}
                </button>

                {result && <Verdict result={result} />}
              </div>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}

function Verdict({ result }: { result: Preview }) {
  const a = result.analysis;
  const dec = result.decision; // "safe" | "advisory" | "block"
  const map = {
    safe: { icon: ShieldCheck, label: "ALLOW", cls: "text-emerald-700", bg: "rgba(5,150,105,0.08)", bd: "rgba(5,150,105,0.25)" },
    advisory: { icon: ShieldAlert, label: "ADVISORY", cls: "text-amber-700", bg: "rgba(180,83,9,0.08)", bd: "rgba(180,83,9,0.25)" },
    block: { icon: ShieldX, label: "BLOCK — never signs", cls: "text-red-700", bg: "rgba(220,38,38,0.07)", bd: "rgba(220,38,38,0.28)" },
  }[dec];
  const Icon = map.icon;
  return (
    <div className="mt-4 rounded-xl p-3.5 text-sm" style={{ background: map.bg, border: `1px solid ${map.bd}` }}>
      <div className={`flex items-center gap-2 font-bold ${map.cls}`}>
        <Icon size={16} /> {map.label}
        <span className="ml-auto text-[10px] font-mono text-ink-400">
          {result.offline ? "offline" : `confidence: ${a.meta?.confidence ?? "?"}`}
        </span>
      </div>
      {a.reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px] text-ink-600">
          {a.reasons.slice(0, 4).map((r, i) => <li key={i}>• {r}</li>)}
        </ul>
      )}
      {a.riskFindings.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {a.riskFindings.slice(0, 6).map((f, i) => (
            <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-ink-900/[0.05] text-ink-600">
              {f.code}
            </span>
          ))}
        </div>
      )}
      {a.estimatedChanges.approvals.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-500">
          Approvals: {a.estimatedChanges.approvals.map((ap) => `${ap.unlimited ? "UNLIMITED" : ap.amount} → ${ap.spender.slice(0, 8)}…`).join(", ")}
        </p>
      )}
      {a.estimatedChanges.native.some((n) => n.deltaWei && n.deltaWei.startsWith("-")) && (
        <p className="mt-1 text-[11px] text-ink-500">
          Native change: {a.estimatedChanges.native.filter((n) => n.deltaWei).map((n) => `${formatEther(n.deltaWei!)} MON`).join(", ")}
        </p>
      )}
    </div>
  );
}

function CodeCard({ icon: Icon, title, sub, children }: { icon: typeof Terminal; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ink-900/8">
        <Icon size={14} className="text-brand-600" />
        <span className="text-sm font-bold text-ink-900">{title}</span>
        <span className="text-[11px] text-ink-400 ml-auto">{sub}</span>
      </div>
      <div className="p-4 space-y-2">{children}</div>
    </div>
  );
}

function Code({ text }: { text: string }) {
  return (
    <pre className="text-[11.5px] leading-relaxed font-mono text-ink-800 bg-bone rounded-lg p-3 overflow-x-auto border border-ink-900/8 whitespace-pre">{text}</pre>
  );
}

function CmdLine({ text }: { text: string }) {
  return (
    <div className="text-[11.5px] font-mono text-ink-800 bg-ink-900/[0.04] rounded-lg px-3 py-2 border border-ink-900/8">
      <span className="text-brand-600">$</span> {text}
    </div>
  );
}
