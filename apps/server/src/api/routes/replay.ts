import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RouteDeps } from "./types.js";
import { analyzeRequestBodySchema } from "../../domain/policy.js";
import {
  analyzeTransaction,
  AnalyzeValidationError,
} from "../../application/analyze-transaction.js";
import { apiError } from "../errors.js";

const replaySchema = analyzeRequestBodySchema.extend({
  /** Informational: the block to reason about. Current build re-simulates at latest. */
  block: z.union([z.string(), z.number()]).optional(),
});

export function registerReplayRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.post("/v1/replay", async (req, reply) => {
    const parsed = replaySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(apiError("INVALID_REQUEST", "Invalid replay request", parsed.error.flatten()));
    }
    try {
      const { block, ...body } = parsed.data;
      const decision = await analyzeTransaction(body, deps);
      return reply.send({ decision, replayedBlock: block ?? "latest" });
    } catch (e) {
      if (e instanceof AnalyzeValidationError) {
        return reply.code(400).send(apiError("INVALID_TRANSACTION", e.message));
      }
      req.log.error(e);
      return reply.code(500).send(apiError("INTERNAL_ERROR", "Replay failed"));
    }
  });
}
