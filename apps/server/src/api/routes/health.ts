import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "./types.js";

export function registerHealthRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get("/health", async () => ({
    status: "ok",
    service: "premon",
    network: deps.config.monad.network,
    chainId: deps.config.monad.chainId,
  }));

  app.get("/health/ready", async (_req, reply) => {
    try {
      const chainId = await deps.createRpc().getChainId();
      const matches = chainId === deps.config.monad.chainId;
      return reply.code(matches ? 200 : 503).send({
        status: matches ? "ready" : "degraded",
        rpcChainId: chainId,
        configuredChainId: deps.config.monad.chainId,
        x402: deps.config.x402.enabled,
      });
    } catch (e) {
      return reply.code(503).send({
        status: "unavailable",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
