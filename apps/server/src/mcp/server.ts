import type { AppConfig } from "../config/index.js";
import type { MonadRpc } from "../infra/monad-rpc.js";
import { analyzeTransaction, AnalyzeValidationError } from "../application/analyze-transaction.js";
import { analyzeRequestBodySchema } from "../domain/policy.js";
import { PROFILES } from "../policy/profiles.js";

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpDeps = {
  config: AppConfig;
  createRpc: () => MonadRpc;
};

const TOOLS: McpTool[] = [
  {
    name: "premon_analyze",
    description:
      "Analyze a Monad/EVM transaction before signing. Returns safe:true/false, risk findings, estimated balance + approval changes, and a human-readable summary.",
    inputSchema: {
      type: "object",
      required: ["network", "transaction"],
      properties: {
        network: { type: "string", enum: ["testnet", "mainnet"] },
        transaction: {
          description: "Raw 0x-hex serialized tx OR a tx-request object {from,to,value,data,...}",
        },
        userWallet: { type: "string", description: "0x address to attribute changes to" },
        policy: { type: "object" },
      },
    },
  },
  {
    name: "premon_health",
    description: "Returns Premon service status and the active Monad network.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "premon_list_profiles",
    description: "List the server-side policy profiles (strict / balanced / permissive).",
    inputSchema: { type: "object", properties: {} },
  },
];

export class McpServer {
  constructor(private readonly deps: McpDeps) {}

  listTools(): McpTool[] {
    return TOOLS;
  }

  async call(name: string, args: unknown): Promise<unknown> {
    switch (name) {
      case "premon_analyze": {
        const parsed = analyzeRequestBodySchema.safeParse(args);
        if (!parsed.success) {
          throw new AnalyzeValidationError(
            `Invalid premon_analyze args: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
          );
        }
        return analyzeTransaction(parsed.data, this.deps);
      }
      case "premon_health":
        return {
          status: "ok",
          network: this.deps.config.monad.network,
          chainId: this.deps.config.monad.chainId,
        };
      case "premon_list_profiles":
        return { profiles: PROFILES };
      default:
        throw new AnalyzeValidationError(`Unknown MCP tool: ${name}`);
    }
  }
}
