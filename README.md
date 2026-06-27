# Premon — Monad / EVM

**Pre-sign transaction security for Monad.** Premon analyzes a transaction
**before it is signed**, runs it through independent risk detectors, applies the
user's policy, and returns `safe: true/false` with reasons — for wallets, dApps,
and AI agents.

This is the **Monad-native port** of [Baret (Stellar)](../BaretStellar). The
architecture transferred 1:1; the chain-specific layers (transaction decode,
simulation, risk model, on-chain contract) were rewritten for the EVM. See
[`docs/PORTING.md`](docs/PORTING.md) for the full Stellar→Monad mapping.

> ⚠️ Built fresh for the Monad hackathon. The original Stellar project was **not
> modified** — this lives in a separate `Premon/` tree.

---

## What it catches

The EVM risk model targets the attack surface that actually drains EVM wallets:

- **Unlimited ERC-20 approvals** (`approve(spender, 2^256-1)`) — the #1 drainer
- **`setApprovalForAll`** operator grants over an entire NFT collection
- **EIP-2612 `permit`** off-chain approvals
- **Reverting transactions** (wasted gas, no effect)
- **Known-malicious addresses** (reputation DB; critical → always blocked)
- **Risky / unknown contracts**, **SELFDESTRUCT**, **DELEGATECALL**, ownership transfers
- **Deep internal-call nesting**, **excessive gas**, and **x402** payment-shape checks

## Live proof (Monad testnet, chainId 10143)

Running against `https://testnet-rpc.monad.xyz`, an unlimited-approve tx returns:

```json
{
  "safe": false,
  "confidence": "high",
  "chainId": 10143,
  "reasons": ["Unlimited ERC-20 approval detected and blocked by policy"],
  "findingCodes": ["ERC20_APPROVAL_GRANTED", "ERC20_APPROVAL_UNLIMITED"],
  "primaryAction": "erc20_approve"
}
```

Monad testnet **supports `debug_traceCall`**, so Premon runs full internal-call
tracing → `confidence: "high"`. On nodes without it, Premon degrades gracefully to
calldata-projected deltas at `medium` confidence (still detects approvals, reverts, etc.).

---

## Repo layout

```
apps/
  server/      Fastify + TypeScript analysis API (the core)
  wallet/      Standalone React smart-wallet (ethers + guard pre-sign)
  showcase/    Demo gallery — EVM threat scenarios + Premon badge/overlay
  extension/   Chrome MV3 + Firefox wallet (EIP-1193/6963 provider + x402 interceptor)
packages/
  guard/         @premon/guard — pre-sign guard SDK (no ethers needed to consume)
  wallet-adapter/dApp ↔ wallet postMessage bridge (EVM)
  ext-protocol/  extension message protocol (EIP-1193)
  ui/            design tokens + brand glyph
  showcase-ui/   showcase UI plumbing
contracts/     Foundry — PaymentGuard.sol (Solidity rewrite of the Soroban vault)
docs/          ARCHITECTURE.md, PORTING.md
```

Full 1:1 port of the Stellar monorepo. Everything typechecks and builds
(`pnpm -r typecheck`, `pnpm -r build`); 27 TS tests + 11 Solidity tests pass.

## Run the full stack

```bash
pnpm install

# 1) Analyzer API (the brain)
cd apps/server && MONAD_RPC_URL=https://testnet-rpc.monad.xyz pnpm dev   # :8080

# 2) Standalone wallet
pnpm --filter @premon/wallet dev        # :5180

# 3) Demo gallery (point it at the analyzer)
pnpm --filter @premon/showcase dev      # :5175

# 4) Browser extension (load apps/extension/dist as an unpacked MV3 extension)
pnpm --filter @premon/extension build
```

The wallet, showcase, and extension all call the analyzer through
`@premon/guard` and refuse to sign what the policy blocks.

## Quickstart

```bash
pnpm install

# Run the analysis server against Monad testnet
cd apps/server
MONAD_RPC_URL=https://testnet-rpc.monad.xyz MONAD_NETWORK=testnet pnpm dev
# → http://localhost:8080

curl localhost:8080/health/ready   # {"status":"ready","rpcChainId":10143,...}
```

Analyze a transaction:

```bash
curl -X POST localhost:8080/v1/analyze -H 'content-type: application/json' -d '{
  "network": "testnet",
  "transaction": { "from": "0x…", "to": "0x<token>", "data": "0x095ea7b3…" },
  "userWallet": "0x…",
  "policy": { "blockUnlimitedApprovals": true }
}'
```

`transaction` accepts **either** a raw `0x`-hex serialized tx **or** a tx-request
object `{from,to,value,data,…}` (the EVM replacement for Stellar's `transactionXdr`).

## Use the guard SDK

```ts
import { TransactionGuard, STRICT_POLICY } from "@premon/guard";

const guard = new TransactionGuard({
  network: "testnet",
  analyze: { baseUrl: "http://localhost:8080" },
});

const { decision, blockingReasons } = await guard.evaluate({
  transaction: { from: userAddr, to: token, data: approveCalldata },
  userWallet: userAddr,
  policy: STRICT_POLICY,
});
// decision: "allow" | "block" — never signs, never submits
```

## Tests

```bash
pnpm -r test                       # 27 TS tests (unit + HTTP + live-shape)
cd contracts && forge test -vv     # 11 Solidity tests incl. a fuzz invariant
```

## API

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET  | `/health`, `/health/ready` | liveness / RPC readiness |
| POST | `/v1/analyze` | analyze one transaction |
| POST | `/v1/analyze/batch` | up to 25 txs |
| POST | `/v1/analyze/stream` | SSE result stream |
| POST | `/v1/replay` | re-simulate |
| GET  | `/v1/audit/recent` · `/aggregate` · `/contract/:address` | audit trail |
| GET/POST | `/mcp/tools` · `/mcp/call` | MCP tools for AI agents |
| GET  | `/demo/scrybe` | x402 paywall demo |

## Configuration

See [`apps/server/.env.example`](apps/server/.env.example). Required:
`MONAD_RPC_URL`. **Set `MONAD_USDC_ADDRESS`** to the real Monad testnet USDC
before relying on token metadata / x402 (the bundled default is a placeholder).
