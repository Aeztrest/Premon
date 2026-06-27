import type { AppConfig } from "../config/index.js";

export type X402PaymentRequirements = {
  scheme: string;
  network: string;
  /** Price string, e.g. "$0.001". */
  maxAmountRequired: string;
  /** Resource being paid for. */
  resource: string;
  description: string;
  mimeType: string;
  /** Token contract used for payment (USDC on Monad). */
  asset: string;
  /** Recipient of the payment (0x). */
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};

/**
 * Builds the x402 PaymentRequirements advertised on a 402 response. EVM x402
 * (the protocol's native habitat — born on Base) uses an `eip155:<chainId>`
 * network id and an ERC-20 (USDC) `asset`, paid via EIP-3009
 * `transferWithAuthorization` to `payTo`.
 */
export function buildAnalyzePaymentRequirements(
  config: AppConfig,
  resource: string,
): X402PaymentRequirements {
  return {
    scheme: "exact",
    network: config.x402.network,
    maxAmountRequired: config.x402.analyzePrice,
    resource,
    description: "Premon transaction analysis",
    mimeType: "application/json",
    asset: config.monad.usdcAddress,
    payTo: config.x402.payTo,
    maxTimeoutSeconds: 60,
    extra: { chainId: config.monad.chainId, decimals: config.monad.usdcDecimals },
  };
}
