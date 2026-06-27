# @premon/guard

Pre-sign transaction guard SDK for **Premon** on **Monad / EVM**. Chain-light —
no `ethers` required to consume. Sends a transaction to Premon's analyzer, applies
your policy, and returns an allow/block decision. **Never signs, never submits.**

```bash
pnpm add @premon/guard
```

```ts
import { TransactionGuard, STRICT_POLICY } from "@premon/guard";

const guard = new TransactionGuard({
  network: "testnet",
  analyze: { baseUrl: "https://premon-api.onrender.com" },
});

const ev = await guard.evaluate({
  transaction: { from, to: token, data: approveCalldata },
  userWallet: from,
  policy: STRICT_POLICY,
});

if (ev.decision === "block") {
  console.warn("Blocked:", ev.blockingReasons);
} else {
  // safe to sign with your wallet of choice
}
```

- `TransactionGuard.evaluate(req)` → `{ decision, blockingReasons, advisoryFindings, analysis }`
- `TransactionGuard.prepare(req)` → throws `GuardBlockedError` on block
- Policy presets: `STRICT_POLICY`, `BALANCED_POLICY`, `PERMISSIVE_POLICY`

For a drop-in **ethers signer** that enforces this automatically, see
[`@premon/agent-kit`](https://www.npmjs.com/package/@premon/agent-kit).

MIT · https://premon.vercel.app
