/**
 * x402 payment helpers — Monad / EVM, native-MON agentic build.
 *
 * The server advertises an `eip155:<chainId>` network and (in this demo) a
 * native MON `asset`. The agent session pays the `maxAmountRequired` (wei) to
 * `payTo`, then ships the on-chain tx hash back in the `X-PAYMENT` header.
 */

/** Mirrors the server's x402 PaymentRequirements. */
export interface PaymentRequirements {
  scheme: string;
  /** `eip155:<chainId>` network id. */
  network: string;
  /** `"native"` for MON, or an ERC-20 token address. */
  asset: string;
  /** Recipient of the payment (0x). */
  payTo: string;
  /** Amount in wei (native) / atomic units, as a plain integer string. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  maxTimeoutSeconds: number;
  extra: {
    chainId?: number;
    decimals?: number;
    symbol?: string;
    priceLabel?: string;
    [k: string]: unknown;
  };
}

/** Payment amount in wei (native) / atomic units. */
export function requiredAmount(requirements: PaymentRequirements): bigint {
  try {
    return BigInt(requirements.maxAmountRequired);
  } catch {
    return 0n;
  }
}

/** Base64-encode the `X-PAYMENT` header from the broadcast payment tx. */
export function encodePaymentHeader(
  txHash: string,
  from: string,
  requirements: PaymentRequirements,
): string {
  const payload = {
    x402Version: 1,
    scheme: requirements.scheme,
    network: requirements.network,
    payload: {
      txHash,
      from,
      asset: requirements.asset,
      payTo: requirements.payTo,
      amount: requirements.maxAmountRequired,
    },
  };
  return btoa(JSON.stringify(payload));
}
