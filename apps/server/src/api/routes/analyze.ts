import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "./types.js";
import { analyzeRequestBodySchema } from "../../domain/policy.js";
import {
  analyzeTransaction,
  AnalyzeValidationError,
} from "../../application/analyze-transaction.js";
import { MonadRpcError } from "../../infra/monad-rpc.js";
import { apiError } from "../errors.js";

export function registerAnalyzeRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.post("/v1/analyze", async (req, reply) => {
    const parsed = analyzeRequestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(apiError("INVALID_REQUEST", "Invalid analyze request", parsed.error.flatten()));
    }
    try {
      const decision = await analyzeTransaction(parsed.data, deps);
      return reply.send(decision);
    } catch (e) {
      if (e instanceof AnalyzeValidationError) {
        return reply.code(400).send(apiError("INVALID_TRANSACTION", e.message));
      }
      if (e instanceof MonadRpcError) {
        return reply.code(502).send(apiError(e.code, e.message));
      }
      req.log.error(e);
      return reply.code(500).send(apiError("INTERNAL_ERROR", "Analysis failed"));
    }
  });
}
