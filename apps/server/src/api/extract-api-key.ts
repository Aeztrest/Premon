import type { FastifyRequest } from "fastify";

/** Pulls an API key from `Authorization: Bearer <key>` or `x-api-key`. */
export function extractApiKey(req: FastifyRequest): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  const x = req.headers["x-api-key"];
  if (typeof x === "string" && x.trim()) return x.trim();
  return null;
}
