/**
 * Showcase-side analyze client (Monad / EVM build). Lets a demo site call
 * Premon's `/v1/analyze` endpoint through the `@premon/guard` SDK — the
 * same pipeline the wallet's sign popup runs, rendered on the site itself so
 * visitors see what the firewall WOULD say before clicking "Sign".
 *
 * The analyze server's base URL comes from `VITE_ANALYZE_URL` and defaults to
 * `http://localhost:8080`. The guard appends `/v1/analyze`.
 */

import {
  TransactionGuard,
  BALANCED_POLICY,
  type AnalysisResult,
  type RiskFinding,
  type GuardPolicy,
  type TransactionInput,
  type EstimatedChanges,
} from "@premon/guard";

export type { AnalysisResult, RiskFinding, GuardPolicy, EstimatedChanges };

/** UI-facing verdict, derived from the analysis + finding severities. */
export type PreviewDecision = "safe" | "advisory" | "block";

export interface PreviewResult {
  decision: PreviewDecision;
  analysis: AnalysisResult;
  offline: boolean;
}

const ANALYZE_URL = import.meta.env.VITE_ANALYZE_URL ?? "http://localhost:8080";
const API_KEY = import.meta.env.VITE_ANALYZE_API_KEY ?? "dev-key-change-me";

/** Default policy the showcase evaluates against — production-style defaults. */
export const SHOWCASE_POLICY: GuardPolicy = BALANCED_POLICY;

const guard = new TransactionGuard({
  network: "testnet",
  analyze: { baseUrl: ANALYZE_URL, apiKey: API_KEY },
});

const EMPTY_CHANGES: EstimatedChanges = {
  native: [],
  assets: [],
  approvals: [],
};

export async function analyzeTransactionForPreview(
  transaction: TransactionInput,
  userWallet: string,
  policy: GuardPolicy = SHOWCASE_POLICY,
): Promise<PreviewResult> {
  try {
    const ev = await guard.evaluate({ transaction, userWallet, policy });
    const analysis = ev.analysis;
    const decision: PreviewDecision = !analysis.safe
      ? "block"
      : hasMediumOrHigher(analysis.riskFindings)
        ? "advisory"
        : "safe";
    return { decision, analysis, offline: false };
  } catch (err) {
    return offlineResult(err instanceof Error ? err.message : String(err));
  }
}

function hasMediumOrHigher(findings: RiskFinding[]): boolean {
  return findings.some(
    (f) =>
      f.severity === "medium" ||
      f.severity === "high" ||
      f.severity === "critical",
  );
}

function offlineResult(reason: string): PreviewResult {
  return {
    decision: "advisory",
    offline: true,
    analysis: {
      safe: false,
      reasons: [`Couldn't reach PREMON: ${reason}`],
      riskFindings: [
        {
          code: "ANALYZE_UNREACHABLE",
          severity: "medium",
          message:
            "Analyze server unreachable; sign only if you trust this dApp.",
        },
      ],
      estimatedChanges: EMPTY_CHANGES,
      simulationWarnings: [],
    },
  };
}
