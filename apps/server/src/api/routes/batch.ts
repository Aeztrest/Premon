import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RouteDeps } from "./types.js";
import { analyzeRequestBodySchema } from "../../domain/policy.js";
import {
  analyzeTransaction,
  AnalyzeValidationError,
} from "../../application/analyze-transaction.js";
import { apiError } from "../errors.js";

const MAX_BATCH = 25;

const batchSchema = z.object({
  items: z.array(analyzeRequestBodySchema).min(1).max(MAX_BATCH),
});

export function registerBatchRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post("/v1/analyze/batch", async (req, reply) => {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(apiError("INVALID_REQUEST", `Batch must be 1–${MAX_BATCH} items`, parsed.error.flatten()));
    }
    const results = await Promise.all(
      parsed.data.items.map(async (item, index) => {
        try {
          const decision = await analyzeTransaction(item, deps);
          return { index, ok: true as const, decision };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { index, ok: false as const, error: msg };
        }
      }),
    );
    return reply.send({ results });
  });

  // Server-Sent Events: stream each result as it completes.
  app.post("/v1/analyze/stream", async (req, reply) => {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(apiError("INVALID_REQUEST", `Batch must be 1–${MAX_BATCH} items`, parsed.error.flatten()));
    }
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    await Promise.all(
      parsed.data.items.map(async (item, index) => {
        let payload: unknown;
        try {
          payload = { index, ok: true, decision: await analyzeTransaction(item, deps) };
        } catch (e) {
          const msg =
            e instanceof AnalyzeValidationError
              ? e.message
              : e instanceof Error
                ? e.message
                : String(e);
          payload = { index, ok: false, error: msg };
        }
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      }),
    );
    reply.raw.write("event: done\ndata: {}\n\n");
    reply.raw.end();
    return reply;
  });
}
