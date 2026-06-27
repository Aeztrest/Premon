import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "./config/index.js";
import { createMonadRpc, type MonadRpc } from "./infra/monad-rpc.js";
import { extractApiKey } from "./api/extract-api-key.js";
import { apiError } from "./api/errors.js";
import { registerHealthRoutes } from "./api/routes/health.js";
import { registerAnalyzeRoute } from "./api/routes/analyze.js";
import { registerBatchRoutes } from "./api/routes/batch.js";
import { registerReplayRoute } from "./api/routes/replay.js";
import { registerAuditRoutes } from "./api/routes/audit.js";
import { registerMcpRoutes } from "./api/routes/mcp.js";
import { registerDemoPaywallRoute } from "./api/routes/demo-paywall.js";

export type BuildAppOptions = {
  /** Override the RPC factory (tests inject a mock). */
  createRpc?: () => MonadRpc;
};

export async function buildApp(
  config: AppConfig,
  opts: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: config.maxBodyBytes,
    requestTimeout: config.requestTimeoutMs,
    trustProxy: config.trustProxy,
  });

  if (config.rateLimitMax > 0) {
    await app.register(rateLimit, {
      max: config.rateLimitMax,
      timeWindow: config.rateLimitWindowMs,
      allowList: (req) => req.url === "/health",
    });
  }

  // CORS — allow browser frontends (wallet/showcase on other origins) to call
  // the analyzer. Same-origin deployments (Vercel /api rewrite) don't need it,
  // but a separately-hosted wallet does. Preflight is answered here.
  app.addHook("onRequest", async (req, reply) => {
    reply.header("access-control-allow-origin", config.corsAllowOrigin);
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header(
      "access-control-allow-headers",
      "content-type,authorization,x-api-key,x-payment",
    );
    reply.header("access-control-max-age", "86400");
    if (req.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  // Auth hook for /v1/* (API-key mode). x402-only protection of /v1/analyze is
  // layered separately; in api_key / both modes a valid key is required when
  // any keys are configured.
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/v1/")) return;
    const requiresApiKey =
      config.authMode === "api_key" || config.authMode === "both";
    if (!requiresApiKey) return;
    if (config.apiKeys.length === 0) return; // open in dev when none configured
    const key = extractApiKey(req);
    if (!key || !config.apiKeys.includes(key)) {
      return reply.code(401).send(apiError("UNAUTHORIZED", "Missing or invalid API key"));
    }
  });

  const createRpc = opts.createRpc ?? (() => createMonadRpc(config));
  const deps = { config, createRpc };

  registerHealthRoutes(app, deps);
  registerAnalyzeRoute(app, deps);
  registerBatchRoutes(app, deps);
  registerReplayRoute(app, deps);
  registerAuditRoutes(app, deps);
  registerMcpRoutes(app, deps);
  registerDemoPaywallRoute(app, deps);

  return app;
}
