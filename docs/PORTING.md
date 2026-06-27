# Stellar → Monad porting notes

Premon's value proposition (pre-sign transaction analysis) is chain-agnostic, so
the **architecture transferred 1:1**. What changed is every layer that touches
the chain. This document records exactly what was reused vs. rewritten.

## Transferred 1:1 (logic preserved, types adapted)

- **Pipeline shape**: decode → collect addresses → simulate → extract deltas →
  detect risks → evaluate policy → suggest → audit.
- **Policy engine** control flow: per-finding gates, fail-closed `isBlocked`,
  `deriveConfidence`, finding de-dup, `maxLossPercent`, `minPost*Balance`.
- **Risk orchestrator** (`runRiskDetection`) fan-out structure.
- **Detectors** that are chain-neutral: simulation-state, contract reputation,
  known-malicious reputation DB, call-tree shape (depth/breadth), gas/fee caps.
- **Guard SDK** surface: `TransactionGuard.evaluate/prepare`, `GuardBlockedError`,
  policy templates (STRICT/BALANCED/PERMISSIVE), HTTP analyze client.
- **Server**: Fastify app, auth hook, rate-limit, batch/stream/replay/audit/MCP
  routes, x402 scaffolding, in-memory audit store.

## Rewritten for the EVM

| Concern | Stellar | Monad / EVM |
| --- | --- | --- |
| Tx encoding | base64 `TransactionEnvelope` XDR | raw `0x` serialized tx **or** tx-request object (ethers) |
| SDK | `@stellar/stellar-sdk` | `ethers` v6 |
| Pre-state | Horizon `loadAccount` | `eth_getBalance` + `eth_getCode` + ERC-20 `balanceOf` |
| Simulation | Soroban `simulateTransaction` (preflight) | `eth_call` (revert) + `eth_estimateGas` + `debug_traceCall` |
| Call tree | Soroban auth tree (`cpi-parser`) | EVM internal-call tree (`callTracer`) |
| "preflighted" | Soroban ran | `traced` (debug_traceCall available) |
| Amounts | stroops (1e7) | wei (1e18), token decimals |
| Addresses | `G…` / `C…` (StrKey) | `0x…` (checksummed) |
| Approvals | Soroban `approve` allowance | ERC-20 `approve` + `permit` |
| Collection approval | — | `setApprovalForAll` |
| Trustlines | classic `changeTrust` | **dropped (no EVM equivalent)** |
| Account drain ops | `accountMerge`, signer/threshold/master-key | **dropped**, replaced by EVM-native: `SELFDESTRUCT`, `DELEGATECALL`, `transferOwnership` |
| Fees | resource fee / base fee (stroops) | gas fee / gas price (wei) |
| x402 network id | `stellar:<network>` | `eip155:<chainId>` |
| x402 payment | Soroban SAC transfer | ERC-20 / EIP-3009 transfer |
| On-chain vault | Soroban `payment-guard` (Rust) | `PaymentGuard.sol` (Solidity, Foundry) |

## Finding-code remap

| Stellar code | Monad code |
| --- | --- |
| `SOROBAN_ALLOWANCE_GRANTED` | `ERC20_APPROVAL_GRANTED` |
| `SOROBAN_ALLOWANCE_UNLIMITED` | `ERC20_APPROVAL_UNLIMITED` |
| `TRUSTLINE_*` / `UNLIMITED_TRUSTLINE` | *(removed)* + new `SET_APPROVAL_FOR_ALL`, `PERMIT_SIGNATURE_DETECTED` |
| `ACCOUNT_MERGE_DETECTED`, `MASTER_KEY_REMOVED`, `SIGNER_CHANGE_DETECTED` | `SELFDESTRUCT_DETECTED`, `DELEGATECALL_DETECTED`, `OWNERSHIP_TRANSFER_DETECTED`, `NATIVE_TRANSFER_TO_CONTRACT` |
| `DEEP_SUB_INVOCATION_NESTING` / `HIGH_OPERATION_COUNT` | `DEEP_CALL_NESTING` / `HIGH_CALL_COUNT` |
| `EXCESSIVE_RESOURCE_FEE` / `EXCESSIVE_BASE_FEE` | `EXCESSIVE_GAS_FEE` / `EXCESSIVE_GAS_PRICE` |
| simulation / reputation / contract / x402 codes | unchanged |

## Apps & shared packages

All three apps and four shared packages were ported too (full monorepo parity).

- **packages/ui, showcase-ui** — design tokens + brand glyph; chain-neutral, copied.
- **packages/wallet-adapter** — dApp↔wallet postMessage bridge: `transactionXdr`
  → EVM `TxRequest`/signed 0x-hex; `connect-approved` now returns `{address, chainId}`.
- **packages/ext-protocol** — extension message registry: Stellar Wallet Standard
  methods → **EIP-1193** methods (`eth_requestAccounts`, `personal_sign`,
  `eth_sendTransaction`, …); balances in wei; approvals replace trustlines/allowances.
- **apps/wallet** — `@stellar/stellar-sdk` Keypair → `ethers.Wallet`; Horizon →
  `JsonRpcProvider`; Friendbot → faucet link; smart-wallet provisioning **dropped**
  (the EOA is the wallet). Send/Sign run `guard.evaluate` before signing.
- **apps/showcase** — 6 EVM threat scenarios (unlimited approve, setApprovalForAll,
  malicious-address transfer, reverting honeypot, high-value native, unknown
  contract); Freighter → injected EIP-1193 + Premon adapter; explorer →
  monadexplorer; Scrybe x402 demo simplified to a USDC `transfer` + `X-PAYMENT`.
- **apps/extension** — **passkey-kit / tweetnacl / Swig sub-keys / provisioning
  dropped**; keys are an `ethers` HD wallet from a BIP-39 mnemonic in an encrypted
  (PBKDF2 + AES-GCM) IndexedDB keystore; inpage provider is **EIP-1193 + EIP-6963**
  on `window.ethereum`; x402 uses **EIP-3009 `transferWithAuthorization`** signed as
  EIP-712 and wrapped in a base64 `X-PAYMENT` header.

## x402 status

The full x402 *shape* is implemented end-to-end (402 challenge → `X-PAYMENT`
header → gated content), and the server ships a `FacilitatorClient` (verify/settle)
plus EVM `PaymentRequirements` (`eip155:<chainId>`, ERC-20/USDC). On-chain
settlement requires a live EVM facilitator configured via `X402_FACILITATOR_URL`;
the bundled demo (`/demo/scrybe`) validates header presence so it runs without one.

## Behavioral note

On Stellar, classic-only txs raise a blocking `LOW_CONFIDENCE_INCOMPLETE_DATA`.
On EVM, lack of a trace is common (not all nodes expose `debug_traceCall`), so it
is **non-blocking** — it only lowers confidence to `medium` and adds a simulation
warning. `eth_call` still tells us whether the tx reverts. Genuine data gaps
(truncated address set, missing wallet for balance rules) remain blocking.
