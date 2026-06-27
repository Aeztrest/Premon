/**
 * Build + sign an x402 "exact" scheme EVM payment (EIP-3009
 * `transferWithAuthorization`).
 *
 * The payer signs an off-chain EIP-712 authorization. The facilitator submits
 * `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce,
 * signature)` on-chain — so the wallet never broadcasts and never pays gas for
 * the micropayment itself.
 */

import { getAddress, hexlify, randomBytes } from "ethers";
import type { EvmSigner } from "../crypto/session";
import type { ChainConfig } from "../../shared/chain";
import { atomicToUi, type PaymentRequirements } from "./parse";

export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface TypedDataDoc {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: Record<string, { name: string; type: string }[]>;
  message: Authorization;
}

export interface BuiltX402Payment {
  authorization: Authorization;
  typedData: TypedDataDoc;
  amountUi: number;
  network: string;
}

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function buildX402Payment(
  payerAddress: string,
  requirements: PaymentRequirements,
  chain: ChainConfig,
): BuiltX402Payment {
  const now = Math.floor(Date.now() / 1000);
  const validBefore = now + (requirements.maxTimeoutSeconds || 60);
  const nonce = hexlify(randomBytes(32));

  const authorization: Authorization = {
    from: getAddress(payerAddress),
    to: getAddress(requirements.payTo),
    value: requirements.amount,
    validAfter: "0",
    validBefore: String(validBefore),
    nonce,
  };

  const typedData: TypedDataDoc = {
    domain: {
      name: requirements.extra.name ?? "USD Coin",
      version: requirements.extra.version ?? "2",
      chainId: chain.chainId,
      verifyingContract: getAddress(requirements.asset),
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES as unknown as TypedDataDoc["types"],
    message: authorization,
  };

  return {
    authorization,
    typedData,
    amountUi: atomicToUi(requirements.amount, chain.usdcDecimals),
    network: requirements.network,
  };
}

/**
 * Sign the EIP-3009 authorization and wrap it into the base64 `X-PAYMENT`
 * header value the merchant's x402 middleware expects.
 */
export async function signX402Payment(
  signer: EvmSigner,
  built: BuiltX402Payment,
): Promise<string> {
  const signature = await signer.signTypedData(
    built.typedData.domain,
    built.typedData.types,
    built.typedData.message,
  );

  const paymentPayload = {
    x402Version: 1,
    scheme: "exact",
    network: built.network,
    payload: {
      signature,
      authorization: built.authorization,
    },
  };

  return btoa(JSON.stringify(paymentPayload));
}
