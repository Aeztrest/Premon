import type { Policy } from "../domain/policy.js";

export type NamedProfile = {
  id: "strict" | "balanced" | "permissive";
  name: string;
  description: string;
  policy: Policy;
};

/**
 * Server-side policy presets for the EVM build. The wallet/SDK has a richer
 * client-side policy; these are the pre-sign subset the server enforces.
 */
export const PROFILES: NamedProfile[] = [
  {
    id: "strict",
    name: "Strict",
    description: "Blocks any approval, unknown contract, selfdestruct/delegatecall, or revert.",
    policy: {
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
    },
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "Production default. Blocks drains and unlimited approvals; permits unknown contracts.",
    policy: {
      maxLossPercent: 50,
      blockUnlimitedApprovals: true,
      blockApprovalForAll: true,
      blockRiskyContracts: true,
      blockSelfdestruct: true,
      blockOwnershipTransfer: true,
      allowWarnings: true,
      requireSuccessfulSimulation: true,
    },
  },
  {
    id: "permissive",
    name: "Permissive",
    description: "Only blocks fatal outcomes (reverts, malicious addresses, selfdestruct).",
    policy: {
      maxLossPercent: 90,
      blockRiskyContracts: true,
      blockSelfdestruct: true,
      requireSuccessfulSimulation: true,
      allowWarnings: true,
    },
  },
];

export function getProfile(id: string): NamedProfile | undefined {
  return PROFILES.find((p) => p.id === id);
}
