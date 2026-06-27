/**
 * x402 payment client — Monad / EVM build (simplified).
 *
 * EVM x402 (the protocol's native habitat) advertises an `eip155:<chainId>`
 * network and an ERC-20 (USDC) `asset`. For the showcase we keep the payment
 * leg simple: build the USDC `transfer(payTo, amount)` call, have the wallet
 * sign it (Premon runs its pre-sign analysis + policy here), and ship the signed
 * transaction back to the merchant in the `X-PAYMENT` header. The merchant's
 * facilitator is responsible for settlement.
 */

import { Interface, parseUnits } from "ethers";
import type { TxRequest } from "@premon/wallet-adapter";

/** Mirrors the server's x402 PaymentRequirements (EVM/USDC on Monad). */
export interface PaymentRequirements {
  scheme: string;
  /** `eip155:<chainId>` network id. */
  network: string;
  /** Price string, e.g. "$0.001". */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  /** ERC-20 token contract used for payment (USDC, 0x). */
  asset: string;
  /** Recipient of the payment (0x). */
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    chainId?: number;
    decimals?: number;
    [k: string]: unknown;
  };
}

const ERC20 = new Interface([
  "function transfer(address to, uint256 amount)",
]);

const MONAD_CHAIN_ID = 10143;
const DEFAULT_USDC_DECIMALS = 6;

/** Convert a "$0.001"-style price string to atomic token units. */
export function priceToAtomic(price: string, decimals: number): bigint {
  const clean = price.replace(/[^0-9.]/g, "") || "0";
  return parseUnits(clean, decimals);
}

/** Build the unsigned EVM USDC-transfer tx that satisfies the 402. */
export function buildX402PaymentTx(
  from: string,
  requirements: PaymentRequirements,
): TxRequest {
  const decimals = Number(requirements.extra?.decimals ?? DEFAULT_USDC_DECIMALS);
  const amount = priceToAtomic(requirements.maxAmountRequired, decimals);
  return {
    from,
    to: requirements.asset,
    data: ERC20.encodeFunctionData("transfer", [requirements.payTo, amount]),
    value: "0",
    chainId: Number(requirements.extra?.chainId ?? MONAD_CHAIN_ID),
  };
}

/** Base64-encode the `X-PAYMENT` header value from a signed transaction. */
export function encodePaymentHeader(
  signedTransaction: string,
  requirements: PaymentRequirements,
): string {
  const payload = {
    x402Version: 1,
    scheme: requirements.scheme,
    network: requirements.network,
    payload: { transaction: signedTransaction },
    accepted: requirements,
  };
  return btoa(JSON.stringify(payload));
}
