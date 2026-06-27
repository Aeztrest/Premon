/**
 * x402 PaymentRequirements validation (Monad / EVM build).
 *
 * Defends against malformed or malicious 402 responses before any signing
 * code runs.
 *
 * EVM-specific:
 *  - `network` is an `eip155:<chainId>` identifier (a few friendly aliases are
 *    also accepted).
 *  - `asset` is an ERC-20 token contract address (0x).
 *  - `payTo` is the merchant's recipient address (0x).
 *  - `extra.feePayer` / `extra.facilitator` carries the facilitator address.
 */

import { isAddress } from "ethers";
import type { MonadNetwork } from "@premon/ext-protocol";
import { CHAINS } from "../../shared/chain";

export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    feePayer?: string;
    facilitator?: string;
    name?: string;
    version?: string;
    memo?: string;
    [k: string]: unknown;
  };
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  network?: MonadNetwork;
}

function resolveNetwork(raw: string): MonadNetwork | null {
  const s = raw.trim().toLowerCase();
  for (const cfg of Object.values(CHAINS)) {
    if (s === `eip155:${cfg.chainId}`) return cfg.network;
    if (s === `monad-${cfg.network}` || s === `monad:${cfg.network}`) return cfg.network;
  }
  if (s === "monad" || s === "monad-testnet" || s === "testnet") return "testnet";
  if (s === "monad-mainnet" || s === "mainnet") return "mainnet";
  return null;
}

export function validateRequirements(req: unknown): ValidationResult {
  if (!req || typeof req !== "object")
    return { ok: false, reason: "Requirements is not an object" };
  const r = req as Record<string, unknown>;

  if (r.scheme !== "exact")
    return { ok: false, reason: `Unsupported scheme: ${String(r.scheme)}` };
  if (typeof r.network !== "string")
    return { ok: false, reason: "Missing network" };
  const network = resolveNetwork(r.network);
  if (!network)
    return { ok: false, reason: `Unsupported network: ${r.network}` };

  if (typeof r.asset !== "string" || !isAddress(r.asset))
    return { ok: false, reason: "asset is not a valid ERC-20 token address" };

  if (typeof r.amount !== "string" || !/^\d+$/.test(r.amount))
    return { ok: false, reason: "amount must be an integer string (atomic token units)" };

  if (typeof r.payTo !== "string" || !isAddress(r.payTo))
    return { ok: false, reason: "payTo is not a valid EVM address" };

  if (
    typeof r.maxTimeoutSeconds !== "number" ||
    r.maxTimeoutSeconds <= 0 ||
    r.maxTimeoutSeconds > 3600
  ) {
    return { ok: false, reason: "maxTimeoutSeconds out of range (1–3600)" };
  }

  const extra = r.extra as Record<string, unknown> | undefined;
  if (extra && typeof extra !== "object")
    return { ok: false, reason: "extra must be an object" };

  return { ok: true, network };
}

/** Atomic → UI conversion for display + cap math, for a token with `decimals`. */
export function atomicToUi(amount: string, decimals = 6): number {
  const a = BigInt(amount);
  const scale = 10n ** BigInt(decimals);
  const intPart = a / scale;
  const fracPart = a % scale;
  return Number(intPart) + Number(fracPart) / Number(scale);
}
