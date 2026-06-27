import type { TxAddressSet } from "../../simulation/account-keys.js";
import type { Policy, PaymentRequirements } from "../../domain/policy.js";
import type { RiskFinding } from "../../domain/findings.js";

/**
 * x402-specific detector for the EVM payment shape (USDC `transfer` /
 * `transferFrom` / EIP-3009 `transferWithAuthorization` to the merchant's
 * payTo). Validates the candidate tx against the merchant's PaymentRequirements
 * and server-side x402 policy rules.
 *
 * Codes:
 *  - X402_MEMO_MISSING — policy requires a memo but none was supplied.
 *  - X402_NON_CANONICAL_ASSET — an asset is not on the policy allowlist.
 *  - X402_DESTINATION_MISMATCH — payTo is not referenced anywhere in the tx.
 *  - X402_ASSET_MISMATCH — required asset is not referenced by the tx.
 */
export function detectX402Findings(input: {
  addressSet: TxAddressSet;
  policy: Policy;
  paymentRequirements?: PaymentRequirements;
}): RiskFinding[] {
  const { addressSet, policy, paymentRequirements } = input;
  const findings: RiskFinding[] = [];

  if (policy.requireMemo) {
    const memo = paymentRequirements?.extra?.memo;
    if (!memo) {
      findings.push({
        code: "X402_MEMO_MISSING",
        severity: "medium",
        message: "Policy requires a payment memo but none was supplied.",
      });
    }
  }

  if (policy.allowedAssets && policy.allowedAssets.length > 0) {
    const allow = new Set(policy.allowedAssets.map((a) => a.toLowerCase()));
    for (const asset of addressSet.assets) {
      if (!allow.has(asset.toLowerCase())) {
        findings.push({
          code: "X402_NON_CANONICAL_ASSET",
          severity: "medium",
          message: `Asset ${asset} is not on the policy allowedAssets list.`,
          details: { asset },
        });
      }
    }
  }

  if (!paymentRequirements) return findings;

  const addrLower = new Set(addressSet.addresses.map((a) => a.toLowerCase()));

  const payTo = paymentRequirements.payTo;
  if (payTo && !addrLower.has(payTo.toLowerCase())) {
    findings.push({
      code: "X402_DESTINATION_MISMATCH",
      severity: "high",
      message: `PaymentRequirements payTo (${payTo}) is not referenced anywhere in the transaction.`,
      details: { payTo },
    });
  }

  const expectedAsset = paymentRequirements.asset;
  if (expectedAsset) {
    const assetsLower = new Set(addressSet.assets.map((a) => a.toLowerCase()));
    if (!assetsLower.has(expectedAsset.toLowerCase())) {
      findings.push({
        code: "X402_ASSET_MISMATCH",
        severity: "high",
        message: `Required asset ${expectedAsset} is not present in the tx.`,
        details: { expectedAsset, txAssets: addressSet.assets },
      });
    }
  }

  return findings;
}
