import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "./types.js";
import { getAuditStore } from "../../data/audit-store.js";
import { apiError } from "../errors.js";

export function registerAuditRoutes(app: FastifyInstance, _deps: RouteDeps): void {
  app.get("/v1/audit/recent", async (req, reply) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(Number(q.limit ?? 200) || 200, 200);
    return reply.send({ records: getAuditStore().recent(limit) });
  });

  app.get("/v1/audit/aggregate", async (_req, reply) => {
    return reply.send(getAuditStore().aggregate());
  });

  app.get("/v1/audit/contract/:address", async (req, reply) => {
    const { address } = req.params as { address: string };
    const stat = getAuditStore().contract(address);
    if (!stat) {
      return reply.code(404).send(apiError("NOT_FOUND", `No audit data for ${address}`));
    }
    return reply.send(stat);
  });
}
