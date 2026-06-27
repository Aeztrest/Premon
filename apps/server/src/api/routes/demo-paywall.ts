import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "./types.js";

/**
 * x402 demo paywall (Scrybe). Always issues the HTTP 402 challenge when no
 * `X-PAYMENT` header is present — independent of X402_ENABLED, since this is a
 * self-contained demo: the client pays by sending a real on-chain USDC transfer
 * to `payTo` and replays the tx hash in `X-PAYMENT`, then gets the answer.
 */

// Demo merchant (valid checksummed EOA).
const DEMO_PAYTO = "0x5CA1Ab1e0000000000000000000000000000c0de";
// 0.001 MON per question, in wei (native payment → an agent session key can
// auto-pay every call without a per-payment popup).
const DEMO_AMOUNT_WEI = "1000000000000000";

const ANSWERS: Record<string, string> = {
  "what is liquid staking?":
    "Liquid staking lets you stake a token to secure a network while receiving a tradable receipt token (e.g. stMON) that keeps earning rewards and can be used elsewhere in DeFi.",
  "how does an amm price swaps?":
    "An AMM prices swaps with a formula over its reserves — classically x·y=k. Each trade moves along that curve, so price impact grows with trade size relative to liquidity.",
  "what does an aggregator route?":
    "A DEX aggregator splits and routes an order across many pools/venues to minimize price impact and fees, returning the best net output for the trade.",
  "explain usdc on monad":
    "USDC on Monad is a standard ERC-20 stablecoin (6 decimals) usable for payments like x402 micropayments — fast and cheap thanks to Monad's parallel EVM execution.",
};

function scrybeAnswer(q: string): string {
  const key = q.trim().toLowerCase();
  if (ANSWERS[key]) return ANSWERS[key]!;
  return `Scrybe (demo oracle): "${q}" — paid answers are served once the x402 USDC payment settles on Monad. This is a hackathon demo; wire a real model behind this endpoint for production.`;
}

export function registerDemoPaywallRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.get("/demo/scrybe", async (req, reply) => {
    const q = (req.query as { q?: string }).q ?? "";
    const cfg = deps.config;
    const paymentHeader = req.headers["x-payment"];

    const payTo = cfg.x402.payTo || DEMO_PAYTO;

    // No payment yet → issue the 402 challenge with PaymentRequirements.
    if (typeof paymentHeader !== "string" || paymentHeader.length === 0) {
      return reply.code(402).send({
        x402Version: 1,
        error: "Payment required",
        accepts: [
          {
            scheme: "exact",
            network: cfg.x402.network, // eip155:<chainId>
            /** "native" → pay in native MON (agent session can auto-settle). */
            asset: "native",
            payTo,
            /** Wei (native MON). */
            maxAmountRequired: DEMO_AMOUNT_WEI,
            resource: "/demo/scrybe",
            description: "Scrybe pay-per-question answer",
            mimeType: "application/json",
            maxTimeoutSeconds: 120,
            extra: {
              chainId: cfg.monad.chainId,
              symbol: cfg.monad.nativeSymbol,
              decimals: cfg.monad.nativeDecimals,
              priceLabel: "0.001 MON",
            },
          },
        ],
      });
    }

    // Payment supplied → decode the header for the on-chain proof, deliver content.
    let txHash: string | null = null;
    let from: string | null = null;
    try {
      const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString("utf8"));
      txHash = decoded?.payload?.txHash ?? decoded?.txHash ?? null;
      from = decoded?.payload?.from ?? decoded?.from ?? null;
    } catch {
      /* tolerate malformed header in the demo */
    }

    return reply.send({
      query: q,
      answer: scrybeAnswer(q),
      paidWith: "x402",
      network: cfg.x402.network,
      asset: "native",
      payTo,
      amount: DEMO_AMOUNT_WEI,
      txHash,
      from,
    });
  });
}
