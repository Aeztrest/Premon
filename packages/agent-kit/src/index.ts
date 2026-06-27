export { GuardedWallet } from "./guarded-wallet.js";
export type { GuardedWalletConfig, GuardOutcome } from "./guarded-wallet.js";

// Re-export the policy presets + guard types so agents need only one import.
export {
  STRICT_POLICY,
  BALANCED_POLICY,
  PERMISSIVE_POLICY,
  POLICY_TEMPLATES,
  GuardBlockedError,
  AnalyzeError,
  type GuardPolicy,
  type MonadNetwork,
  type AnalysisResult,
  type RiskFinding,
  type RiskSeverity,
} from "@premon/guard";
