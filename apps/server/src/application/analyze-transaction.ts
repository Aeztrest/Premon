import { isAddress, getAddress } from "ethers";
import type { AppConfig } from "../config/index.js";
import type { AnalyzeRequestBody } from "../domain/policy.js";
import type { Decision } from "../domain/decision.js";
import { MonadRpcError, type MonadRpc } from "../infra/monad-rpc.js";
import { collectTxAddresses } from "../simulation/account-keys.js";
import { decodeTransaction, TxDecodeError } from "../simulation/tx-decode.js";
import { EvmSimulator, pickAccountsForSimulation } from "../simulation/evm-simulator.js";
import { buildPreAccountsMap, extractEstimatedChanges } from "../analysis/extract-deltas.js";
import { decodeTransactionOperations } from "../analysis/instruction-decoder.js";
import { generateSuggestions } from "../analysis/suggestion-engine.js";
import { runRiskDetection } from "../risk/index.js";
import { evaluatePolicy } from "../policy/engine.js";
import { getAuditStore } from "../data/audit-store.js";

export type AnalyzeTimings = {
  preFetchMs: number;
  simulateMs: number;
  postSimMs: number;
  totalMs: number;
};

export type AnalyzeDeps = {
  config: AppConfig;
  /** Factory returns the configured single-network RPC adapter. */
  createRpc: () => MonadRpc;
  onAnalyzeTimings?: (t: AnalyzeTimings) => void;
};

export class AnalyzeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzeValidationError";
  }
}

export async function analyzeTransaction(
  body: AnalyzeRequestBody,
  deps: AnalyzeDeps,
): Promise<Decision> {
  const { config, createRpc, onAnalyzeTimings } = deps;
  const t0 = performance.now();

  if (body.network !== config.monad.network) {
    throw new AnalyzeValidationError(
      `Server is configured for ${config.monad.network}, request asked for ${body.network}`,
    );
  }

  let tx;
  try {
    tx = decodeTransaction(body.transaction);
  } catch (e) {
    if (e instanceof TxDecodeError) {
      throw new AnalyzeValidationError(`Invalid transaction: ${e.message}`);
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new AnalyzeValidationError(`Invalid transaction: ${msg}`);
  }

  let userWallet: string | null = null;
  if (body.userWallet) {
    if (!isAddress(body.userWallet)) {
      throw new AnalyzeValidationError("Invalid userWallet: not a 0x EVM address");
    }
    userWallet = getAddress(body.userWallet);
  }
  // Default the attribution wallet to the tx sender when not supplied.
  if (!userWallet && tx.from) userWallet = tx.from;

  // 1. Discover addresses / tokens / assets in the tx.
  const addressSet = collectTxAddresses(tx);
  const accountAddresses = pickAccountsForSimulation(
    addressSet.addresses,
    config.maxSimulationOperations,
  );
  const truncatedAccounts = addressSet.addresses.length > accountAddresses.length;

  // 2. Simulation: pre-state + eth_call + (optional) trace.
  const rpc = createRpc();
  const simulator = new EvmSimulator(config, () => rpc);
  const t1 = performance.now();
  const preFetchMs = t1 - t0;

  let simResult;
  try {
    simResult = await simulator.simulate({ tx, addressSet, accountAddresses });
  } catch (e) {
    if (e instanceof MonadRpcError) throw e;
    throw new MonadRpcError(
      "RPC_UNAVAILABLE",
      e instanceof Error ? e.message : String(e),
      e,
    );
  }
  const { simulation, callTrace } = simResult;
  const t2 = performance.now();
  const simulateMs = t2 - t1;

  // 3. Post-sim: deltas, summary, contract set, detectors, policy.
  const preMap = buildPreAccountsMap(simulation.accounts);
  const estimatedChanges = extractEstimatedChanges(preMap, simulation, tx, userWallet);
  const summary = decodeTransactionOperations(tx);

  const contractAddresses = [
    ...new Set([
      ...simulation.accounts.filter((a) => a.isContract).map((a) => a.accountId),
      ...callTrace.allContractAddresses,
    ]),
  ];

  const riskFindings = runRiskDetection({
    config,
    policy: body.policy,
    simulation,
    addressSet,
    contractAddresses,
    estimatedChanges,
    truncatedAccounts,
    userWallet,
    callTrace,
    summary,
    tx,
    paymentRequirements: body.paymentRequirements,
  });

  const simulationWarnings: string[] = [];
  if (!simulation.traced) {
    simulationWarnings.push(
      "Execution not traced (node lacks debug_traceCall); deltas projected from calldata.",
    );
  }

  const decision = evaluatePolicy({
    network: config.monad.network,
    chainId: config.monad.chainId,
    policy: body.policy,
    simulation,
    estimatedChanges,
    riskFindings,
    simulationWarnings,
    usdcAddress: config.monad.usdcAddress,
    usdcDecimals: config.monad.usdcDecimals,
    userWallet,
    integratorRequestId: body.integratorRequestId,
  });

  decision.annotation = { summary, callTrace };
  decision.suggestions = generateSuggestions(decision, simulation, summary).suggestions;

  const t3 = performance.now();
  const postSimMs = t3 - t2;

  try {
    getAuditStore().record(decision, { durationMs: t3 - t0, userWallet });
  } catch {
    /* audit is best-effort */
  }

  onAnalyzeTimings?.({ preFetchMs, simulateMs, postSimMs, totalMs: t3 - t0 });
  return decision;
}
