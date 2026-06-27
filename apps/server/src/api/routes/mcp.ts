import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RouteDeps } from "./types.js";
import { McpServer } from "../../mcp/server.js";
import { AnalyzeValidationError } from "../../application/analyze-transaction.js";
import { apiError } from "../errors.js";

const callSchema = z.object({
  name: z.string(),
  arguments: z.unknown().optional(),
});

export function registerMcpRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const mcp = new McpServer(deps);

  app.get("/mcp/tools", async (_req, reply) => {
    return reply.send({ tools: mcp.listTools() });
  });

  app.post("/mcp/call", async (req, reply) => {
    const parsed = callSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(apiError("INVALID_REQUEST", "Expected { name, arguments }", parsed.error.flatten()));
    }
    try {
      const result = await mcp.call(parsed.data.name, parsed.data.arguments);
      return reply.send({ result });
    } catch (e) {
      if (e instanceof AnalyzeValidationError) {
        return reply.code(400).send(apiError("INVALID_REQUEST", e.message));
      }
      req.log.error(e);
      return reply.code(500).send(apiError("INTERNAL_ERROR", "MCP call failed"));
    }
  });
}
