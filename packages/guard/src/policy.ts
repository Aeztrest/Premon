/**
 * Premon guard policy — Monad / EVM build.
 *
 * The server-side schema (apps/server/src/domain/policy.ts) carries the
 * pre-sign subset; client-only rules (x402 rolling caps, behavioral alerts)
 * live in the wallet.
 */

export interface GuardPolicy {
  /* ───── Pre-sign rules (server + client both evaluate) ───── */

  /** Reject if estimated native (MON) loss exceeds this % of the wallet's pre-balance. 0–100. */
  maxLossPercent?: number;
  /** Reject if post-tx balance of the configured asset falls below this UI amount. */
  minPostUsdcBalance?: number;
  /** Token the min balance applies to (0x address). Defaults to USDC. */
  minPostAsset?: string;

  /** Reject any ERC-20 `approve` the tx grants. */
  blockApprovals?: boolean;
  /** Reject unlimited (uint256-max) ERC-20 approvals. */
  blockUnlimitedApprovals?: boolean;
  /** Reject ERC-721 / ERC-1155 `setApprovalForAll` grants. */
  blockApprovalForAll?: boolean;

  /** Reject contracts flagged risky by the reputation DB / config. */
  blockRiskyContracts?: boolean;
  /** Reject any contract not on the known-safe list. */
  blockUnknownContractExposure?: boolean;

  /** Reject txs whose trace contains SELFDESTRUCT. */
  blockSelfdestruct?: boolean;
  /** Reject txs whose trace contains DELEGATECALL. */
  blockDelegatecall?: boolean;
  /** Reject ownership-transfer calls. */
  blockOwnershipTransfer?: boolean;

  /** If true, medium advisories alone do not block. Critical/high still do. */
  allowWarnings?: boolean;
  /** When true (default), the tx must not revert in simulation for safe=true. */
  requireSuccessfulSimulation?: boolean;

  /* ───── x402 protocol rules ───── */

  x402AutoApprove?: boolean;
  maxX402PerTx?: number;
  x402HourlyCap?: number;
  x402DailyCap?: number;
  allowedFacilitators?: string[];
  allowedAssets?: string[];
  allowedMerchantOrigins?: string[];
  blockedMerchantOrigins?: string[];
  requireMemo?: boolean;

  /** Reject txs whose estimated total gas fee exceeds this wei value. */
  maxGasFeeWei?: number;
  /** Reject txs whose effective gas price exceeds this wei value. */
  maxGasPriceWei?: number;

  /** Refuse approvals at the uint256-max sentinel — always cap. */
  refuseUnlimitedApprovals?: boolean;
}

/* ────── Templates ────── */

export const STRICT_POLICY: GuardPolicy = {
  maxLossPercent: 25,
  blockApprovals: true,
  blockUnlimitedApprovals: true,
  blockApprovalForAll: true,
  blockRiskyContracts: true,
  blockUnknownContractExposure: true,
  blockSelfdestruct: true,
  blockDelegatecall: true,
  blockOwnershipTransfer: true,
  allowWarnings: false,
  requireSuccessfulSimulation: true,
  x402AutoApprove: false,
  maxX402PerTx: 0.1,
  x402HourlyCap: 1.0,
  x402DailyCap: 5.0,
  refuseUnlimitedApprovals: true,
};

export const BALANCED_POLICY: GuardPolicy = {
  maxLossPercent: 50,
  blockUnlimitedApprovals: true,
  blockApprovalForAll: true,
  blockRiskyContracts: true,
  blockSelfdestruct: true,
  blockOwnershipTransfer: true,
  allowWarnings: true,
  requireSuccessfulSimulation: true,
  x402AutoApprove: true,
  maxX402PerTx: 1.0,
  x402HourlyCap: 5.0,
  x402DailyCap: 25.0,
  refuseUnlimitedApprovals: true,
};

export const PERMISSIVE_POLICY: GuardPolicy = {
  maxLossPercent: 90,
  blockRiskyContracts: true,
  blockSelfdestruct: true,
  requireSuccessfulSimulation: true,
  allowWarnings: true,
  x402AutoApprove: true,
  maxX402PerTx: 10.0,
  x402HourlyCap: 50.0,
  x402DailyCap: 250.0,
  refuseUnlimitedApprovals: false,
};

export type PolicyTemplateId = "strict" | "balanced" | "permissive" | "custom";

export interface PolicyTemplate {
  id: PolicyTemplateId;
  name: string;
  description: string;
  policy: GuardPolicy;
}

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  { id: "strict", name: "Strict", description: "Block any suspicious activity. Tight x402 caps.", policy: STRICT_POLICY },
  { id: "balanced", name: "Balanced", description: "Production default. Blocks drains and unlimited approvals.", policy: BALANCED_POLICY },
  { id: "permissive", name: "Permissive", description: "Only blocks fatal outcomes. Generous caps.", policy: PERMISSIVE_POLICY },
];

const NUM = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validatePolicy(p: GuardPolicy): void {
  if (p.maxLossPercent !== undefined && (!NUM(p.maxLossPercent) || p.maxLossPercent < 0 || p.maxLossPercent > 100)) {
    throw new Error("maxLossPercent must be a number between 0 and 100");
  }
  if (p.minPostUsdcBalance !== undefined && (!NUM(p.minPostUsdcBalance) || p.minPostUsdcBalance < 0)) {
    throw new Error("minPostUsdcBalance must be a non-negative number");
  }
  if (p.minPostAsset !== undefined && typeof p.minPostAsset !== "string") {
    throw new Error("minPostAsset must be a token address string");
  }
  if (p.maxGasFeeWei !== undefined && (!NUM(p.maxGasFeeWei) || p.maxGasFeeWei < 0)) {
    throw new Error("maxGasFeeWei must be non-negative");
  }
  if (p.maxGasPriceWei !== undefined && (!NUM(p.maxGasPriceWei) || p.maxGasPriceWei < 0)) {
    throw new Error("maxGasPriceWei must be non-negative");
  }
}

export function normalizePolicy(p: GuardPolicy): GuardPolicy {
  const out: GuardPolicy = {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
