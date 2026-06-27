import { analyzeTransaction, type AnalyzeClientConfig } from "./analyze.js";
import { GuardBlockedError } from "./errors.js";
import { normalizePolicy, validatePolicy, type GuardPolicy } from "./policy.js";
import type { AnalysisResult, MonadNetwork, RiskFinding, TransactionInput } from "./types.js";

export type GuardDecision = "allow" | "block";

export interface GuardEvaluation {
  decision: GuardDecision;
  advisoryFindings: RiskFinding[];
  blockingReasons: string[];
  analysis: AnalysisResult;
  /** The transaction input, preserved verbatim for sign+send. */
  transaction: TransactionInput;
}

export interface GuardConfig {
  analyze: AnalyzeClientConfig;
  network: MonadNetwork;
}

export interface EvaluateRequest {
  /**
   * The transaction to evaluate: a raw 0x-hex serialized tx or a tx-request
   * object. The guard does not build it — wallet/account-abstraction wrapping
   * varies. The guard's job is to run it through Premon's analyzer and apply the
   * user's policy. Never signs, never submits.
   */
  transaction: TransactionInput;
  /** User's 0x address (for balance attribution). */
  userWallet?: string;
  policy: GuardPolicy;
  integratorRequestId?: string;
  paymentRequirements?: {
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: Record<string, unknown>;
  };
}

export class TransactionGuard {
  constructor(private readonly cfg: GuardConfig) {}

  /**
   * Ship the tx to Premon /v1/analyze, evaluate against the policy, return a
   * structured GuardEvaluation. Never signs, never submits, never throws on a
   * policy violation — returns `decision: "block"` so the caller renders denial.
   */
  async evaluate(req: EvaluateRequest): Promise<GuardEvaluation> {
    validatePolicy(req.policy);

    const analysis = await analyzeTransaction(this.cfg.analyze, {
      network: this.cfg.network,
      transaction: req.transaction,
      userWallet: req.userWallet,
      policy: normalizePolicy(req.policy),
      integratorRequestId: req.integratorRequestId,
      paymentRequirements: req.paymentRequirements,
    });

    const blockingReasons = analysis.safe ? [] : analysis.reasons;
    const advisoryFindings = analysis.safe
      ? analysis.riskFindings.filter((f) => f.severity === "medium" || f.severity === "low")
      : [];

    return {
      decision: analysis.safe ? "allow" : "block",
      advisoryFindings,
      blockingReasons,
      analysis,
      transaction: req.transaction,
    };
  }

  /** Like `evaluate` but throws `GuardBlockedError` on block (exception flow for agents). */
  async prepare(req: EvaluateRequest): Promise<{
    transaction: TransactionInput;
    analysis: AnalysisResult;
  }> {
    const ev = await this.evaluate(req);
    if (ev.decision === "block") {
      throw new GuardBlockedError(
        ev.blockingReasons[0] ?? "Premon policy blocked this transaction",
        ev.analysis,
        ev.blockingReasons,
      );
    }
    return { transaction: ev.transaction, analysis: ev.analysis };
  }
}
