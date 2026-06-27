# @premon/agent-kit

Guard your **agent / program wallet** with [Premon](https://premon.vercel.app).
A drop-in `ethers` signer + CLI that runs every transaction through Premon's
pre-sign firewall and **refuses to sign** anything your policy blocks — so a
poisoned prompt, a bad tool, or a malicious dependency can't drain the wallet.

```bash
pnpm add @premon/agent-kit
```

## SDK — `GuardedWallet`

```ts
import { GuardedWallet, STRICT_POLICY } from "@premon/agent-kit";

const agent = new GuardedWallet({
  privateKey: process.env.AGENT_KEY!,
  rpcUrl:     "https://testnet-rpc.monad.xyz",
  analyzeUrl: "https://premon-api.onrender.com",
  policy:     STRICT_POLICY,
});

// Premon simulates + policy-checks FIRST. On a block this throws
// GuardBlockedError and never signs.
await agent.sendTransaction({ to: token, data: approveCalldata });

// Dry-run without signing:
const { decision, blockingReasons } = await agent.evaluate({ to, data });
```

## CLI — `premon`

```bash
export PREMON_PRIVATE_KEY=0xYOUR_AGENT_KEY

premon address                                   # show the agent address
premon analyze --to 0xToken --data 0x.. --policy strict   # dry-run verdict
premon send    --to 0xToken --data 0x.. --policy strict   # guarded send
premon policy strict                             # print a policy as JSON
```

Env: `PREMON_PRIVATE_KEY`, `PREMON_RPC_URL`, `PREMON_ANALYZE_URL`,
`PREMON_API_KEY`, `PREMON_NETWORK`, `PREMON_POLICY`.

Policies: `STRICT_POLICY`, `BALANCED_POLICY`, `PERMISSIVE_POLICY` (or `--policy strict|balanced|permissive`).

MIT · https://premon.vercel.app/agents
