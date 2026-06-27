import type { NormalizedSimulation } from "../../domain/simulation-normalized.js";
import type { RiskFinding } from "../../domain/findings.js";

/**
 * Surfaces simulation-state failures:
 *  - `SIMULATION_FAILED` (high) when `eth_call` reverted.
 *
 * Note: lack of an execution trace is NOT treated as a blocking finding. Many
 * Monad RPC endpoints don't expose `debug_traceCall`; we still know whether the
 * tx reverts (via `eth_call`) and project balance/approval deltas from calldata.
 * The "not traced" condition only lowers the decision confidence to `medium`
 * (see the policy engine's `deriveConfidence`) and is surfaced as a
 * non-blocking simulation warning by the orchestrator.
 */
export function detectSimulationFindings(
  simulation: NormalizedSimulation,
): RiskFinding[] {
  const findings: RiskFinding[] = [];
  if (simulation.status === "failed") {
    findings.push({
      code: "SIMULATION_FAILED",
      severity: "high",
      message: `eth_call reverted: ${simulation.err}`,
      details: { err: simulation.err },
    });
  }
  return findings;
}
