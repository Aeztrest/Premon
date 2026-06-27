# Premon (Monad) — Architecture

Module-by-module description of the EVM implementation. Source of truth is the
code under `apps/server/src`, `packages/guard/src`, `contracts/src`.

## Request lifecycle — `POST /v1/analyze`

Body: `{ network, transaction, policy?, userWallet?, integratorRequestId?, paymentRequirements? }`
where `transaction` is a raw `0x` serialized tx or a `{from,to,value,data,…}` object.

```
[1] rate limit (IP) + auth (API key / x402)
[2] zod body validation
            │  application/analyze-transaction.ts
[3] decodeTransaction()        raw hex | object → DecodedEvmTx (ethers)
[4] collectTxAddresses()       from/to + ABI-decoded args → addresses/tokens/assets
[5] pickAccountsForSimulation()cap to MAX_SIMULATION_OPERATIONS
[6] EvmSimulator.simulate()    pre-state (getBalance/getCode/balanceOf)
                               + eth_call (revert) + estimateGas + debug_traceCall
[7] extractEstimatedChanges()  native + ERC-20 deltas + approval grants
[8] decodeTransactionOperations()  human-readable summary
[9] runRiskDetection()         all detectors
[10] evaluatePolicy()          gates + fail-closed decision
[11] generateSuggestions()     actionable fixes
[12] audit.record()
            ▼
{ safe, reasons, estimatedChanges, riskFindings, simulationWarnings, annotation, suggestions, meta }
```

## Modules

- **config/** — env (zod), Monad network table (chainId 10143/143), USDC, limits.
- **simulation/**
  - `abi.ts` — known selectors (ERC-20/721/1155/Ownable) + calldata decode.
  - `tx-decode.ts` — raw hex / object → `DecodedEvmTx`.
  - `account-keys.ts` — address/token/asset extraction from calldata.
  - `evm-simulator.ts` — concurrent pre-state + `eth_call` + `estimateGas` + trace.
  - `parse-call-trace.ts` — `callTracer` frames → generic `CallTrace`.
- **infra/monad-rpc.ts** — `MonadRpc` interface (mockable) + ethers adapter;
  `debug_traceCall` is feature-detected and cached.
- **analysis/** — `extract-deltas` (intent-projected balance/approval deltas),
  `instruction-decoder` (summary), `suggestion-engine`.
- **risk/detectors/** — `simulation`, `programs` (risky/unknown), `reputation`,
  `compute` (gas), `cpi` (call nesting), `approvals` (the drainer surface),
  `evm-danger` (selfdestruct/delegatecall/ownership/native-to-contract), `x402`.
- **policy/** — `engine` (gates + `isBlocked` fail-closed; critical findings
  always block), `profiles` (strict/balanced/permissive).
- **mcp/server.ts** — `premon_analyze`, `premon_health`, `premon_list_profiles`.
- **api/routes/** — health, analyze, batch, stream, replay, audit, mcp, demo-paywall.
- **data/** — in-memory `audit-store`, seeded `reputation-db`.

## Domain types (`domain/`)

- `NormalizedSimulation` — `status`, `traced`, `accounts[]`, `callEvents[]`,
  `gasFeeWei`, `gasUsed`, `gasPriceWei`.
- `EstimatedChanges` — `native[]` (wei), `assets[]` (ERC-20), `approvals[]`.
- `CallTrace` — `roots[]`, `maxDepth`, `totalInvocations`, `hasDelegateCall`, `hasSelfdestruct`.
- `RiskFinding` — `{ code, severity, message, details? }`.
- `Decision` — `safe`, `reasons`, `estimatedChanges`, `riskFindings`,
  `simulationWarnings`, `annotation`, `suggestions`, `meta{network,chainId,confidence,…}`.

## Confidence model

`high` = traced + non-revert. `medium` = not traced (node lacks `debug_traceCall`;
deltas projected from calldata). `low` = revert or genuinely incomplete inputs.

## On-chain — `contracts/PaymentGuard.sol`

The Solidity rewrite of the Soroban spending-limit vault: owner deposits a token,
grants per-merchant per-tx + rolling-24h caps, and an agent calls `pay()` to
settle micropayments without per-payment owner signatures — the caps are the
firewall. See `contracts/README.md`.
