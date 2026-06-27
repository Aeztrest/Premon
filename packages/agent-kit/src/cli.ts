#!/usr/bin/env node
/**
 * premon — guard an agent / program wallet from the command line.
 *
 * Every `send` runs through Premon's pre-sign firewall first; if the policy
 * blocks it, nothing is signed. Config via env:
 *   PREMON_PRIVATE_KEY   (required for address/analyze/send)
 *   PREMON_RPC_URL       (default https://testnet-rpc.monad.xyz)
 *   PREMON_ANALYZE_URL   (default https://premon-api.onrender.com)
 *   PREMON_API_KEY       (default dev-key-change-me)
 *   PREMON_NETWORK       (testnet | mainnet, default testnet)
 *   PREMON_POLICY        (strict | balanced | permissive, default balanced)
 */

import { parseEther } from "ethers";
import {
  GuardedWallet,
  GuardBlockedError,
  STRICT_POLICY,
  BALANCED_POLICY,
  PERMISSIVE_POLICY,
  type GuardPolicy,
  type MonadNetwork,
} from "./index.js";

const POLICIES: Record<string, GuardPolicy> = {
  strict: STRICT_POLICY,
  balanced: BALANCED_POLICY,
  permissive: PERMISSIVE_POLICY,
};

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a || !a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function resolvePolicy(flag?: string | boolean): { name: string; policy: GuardPolicy } {
  const name = (typeof flag === "string" ? flag : env("PREMON_POLICY", "balanced")) ?? "balanced";
  const policy = POLICIES[name];
  if (!policy) {
    fail(`Unknown policy "${name}". Use: strict | balanced | permissive.`);
  }
  return { name, policy: policy! };
}

function makeWallet(policy: GuardPolicy): GuardedWallet {
  const privateKey = env("PREMON_PRIVATE_KEY");
  if (!privateKey) fail("PREMON_PRIVATE_KEY is not set.");
  return new GuardedWallet({
    privateKey: privateKey!,
    rpcUrl: env("PREMON_RPC_URL", "https://testnet-rpc.monad.xyz")!,
    analyzeUrl: env("PREMON_ANALYZE_URL", "https://premon-api.onrender.com")!,
    apiKey: env("PREMON_API_KEY", "dev-key-change-me"),
    network: (env("PREMON_NETWORK", "testnet") as MonadNetwork),
    policy,
  });
}

function buildTx(flags: Record<string, string | boolean>) {
  const to = typeof flags.to === "string" ? flags.to : undefined;
  const data = typeof flags.data === "string" ? flags.data : undefined;
  const valueStr = typeof flags.value === "string" ? flags.value : undefined;
  if (!to && !data) fail("Provide at least --to (and optionally --data / --value).");
  return {
    to,
    data,
    value: valueStr ? parseEther(valueStr) : undefined,
  };
}

function printOutcome(o: { decision: string; blockingReasons: string[]; analysis: { riskFindings: { code: string; severity: string; message: string }[]; meta?: { confidence?: string } } }): void {
  const verdict = o.decision === "allow" ? "✅ ALLOW" : "⛔ BLOCK";
  console.log(`\n  ${verdict}   (confidence: ${o.analysis.meta?.confidence ?? "?"})`);
  if (o.blockingReasons.length) {
    console.log("\n  Blocking reasons:");
    for (const r of o.blockingReasons) console.log(`    • ${r}`);
  }
  const findings = o.analysis.riskFindings ?? [];
  if (findings.length) {
    console.log("\n  Findings:");
    for (const f of findings) console.log(`    [${f.severity.toUpperCase()}] ${f.code} — ${f.message}`);
  }
  console.log("");
}

function fail(msg: string): never {
  console.error(`premon: ${msg}`);
  process.exit(1);
}

const USAGE = `premon — Premon agent wallet guard

Usage:
  premon address                      Print the agent wallet address
  premon analyze --to 0x.. [opts]     Dry-run: analyze a tx, print the verdict (no signing)
  premon send    --to 0x.. [opts]     Guarded send: analyze, then sign+broadcast only if allowed
  premon policy  [strict|balanced|permissive]   Print a policy as JSON

Options:
  --to 0x...        Recipient / contract address
  --data 0x...      Calldata (for contract calls)
  --value 0.01      Native MON amount (decimal)
  --policy <name>   strict | balanced | permissive (overrides PREMON_POLICY)

Env: PREMON_PRIVATE_KEY, PREMON_RPC_URL, PREMON_ANALYZE_URL, PREMON_API_KEY,
     PREMON_NETWORK, PREMON_POLICY`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (cmd) {
    case "address": {
      const { policy } = resolvePolicy(flags.policy);
      const w = makeWallet(policy);
      console.log(w.address);
      return;
    }
    case "analyze": {
      const { name, policy } = resolvePolicy(flags.policy);
      const w = makeWallet(policy);
      console.log(`Analyzing as ${w.address} · policy=${name} · network=${w.network}`);
      const outcome = await w.evaluate(buildTx(flags));
      printOutcome(outcome);
      process.exit(outcome.decision === "allow" ? 0 : 2);
      return;
    }
    case "send": {
      const { name, policy } = resolvePolicy(flags.policy);
      const w = makeWallet(policy);
      console.log(`Sending as ${w.address} · policy=${name} · network=${w.network}`);
      try {
        const resp = await w.sendTransaction(buildTx(flags));
        console.log(`\n  ✅ Sent. tx: ${resp.hash}\n`);
      } catch (e) {
        if (e instanceof GuardBlockedError) {
          console.log("\n  ⛔ BLOCKED by Premon — nothing was signed.");
          for (const r of e.blockingReasons) console.log(`    • ${r}`);
          console.log("");
          process.exit(2);
        }
        throw e;
      }
      return;
    }
    case "policy": {
      const { policy } = resolvePolicy(typeof rest[0] === "string" && !rest[0].startsWith("--") ? rest[0] : flags.policy);
      console.log(JSON.stringify(policy, null, 2));
      return;
    }
    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(USAGE);
      return;
    default:
      fail(`Unknown command "${cmd}". Run "premon help".`);
  }
}

main().catch((e) => {
  console.error(`premon: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
