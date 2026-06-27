import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "./types.js";
import { buildAnalyzePaymentRequirements } from "../../x402/requirements.js";

/**
 * x402 demo paywall. With X402 enabled and no `X-PAYMENT` header, returns HTTP
 * 402 + PaymentRequirements (EVM/USDC on Monad). With a payment header present
 * it returns the gated content. This powers the showcase "pay-per-call" demo.
 */
export function registerDemoPaywallRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.get("/demo/scrybe", async (req, reply) => {
    const q = (req.query as { q?: string }).q ?? "";
    const hasPayment = typeof req.headers["x-payment"] === "string";

    if (deps.config.x402.enabled && !hasPayment) {
      const requirements = buildAnalyzePaymentRequirements(deps.config, "/demo/scrybe");
      return reply.code(402).send({
        x402Version: 1,
        error: "Payment required",
        accepts: [requirements],
      });
    }

    return reply.send({
      query: q,
      answer: `Scrybe demo answer for "${q}" (gated content delivered).`,
      paidWith: hasPayment ? "x402" : "free-mode",
      network: deps.config.x402.network,
    });
  });
}
