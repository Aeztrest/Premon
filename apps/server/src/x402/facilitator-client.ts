import type { AppConfig } from "../config/index.js";
import type { X402PaymentRequirements } from "./requirements.js";

export type VerifyResult = { isValid: boolean; invalidReason?: string; payer?: string };
export type SettleResult = { success: boolean; txHash?: string; networkId?: string; errorReason?: string };

/**
 * Thin HTTP client for an x402 facilitator (verify + settle). Mirrors the
 * Stellar build's facilitator client but speaks the EVM x402 shape. Network
 * failures are surfaced to the caller, which fails closed (no settlement → 402).
 */
export class FacilitatorClient {
  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(
    paymentPayload: unknown,
    requirements: X402PaymentRequirements,
  ): Promise<VerifyResult> {
    const res = await this.post("/verify", { paymentPayload, paymentRequirements: requirements });
    return res as VerifyResult;
  }

  async settle(
    paymentPayload: unknown,
    requirements: X402PaymentRequirements,
  ): Promise<SettleResult> {
    const res = await this.post("/settle", { paymentPayload, paymentRequirements: requirements });
    return res as SettleResult;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const url = `${this.config.x402.facilitatorUrl.replace(/\/+$/, "")}${path}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`facilitator ${path} returned HTTP ${res.status}: ${text}`);
    }
    return res.json();
  }
}
