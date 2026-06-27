import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
import { loadConfig } from "../config/index.js";
import { buildApp } from "../app.js";
import type { MonadRpc } from "../infra/monad-rpc.js";
import { UINT256_MAX } from "../simulation/abi.js";

const ERC20 = new Interface(["function approve(address spender, uint256 amount)"]);
const USER = "0x1111111111111111111111111111111111111111";
const SPENDER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0xf817257fed379853cDe0fa4F97AB987181B1E5Ea";

class MockRpc implements MonadRpc {
  async getChainId() {
    return 10143;
  }
  async getBalance() {
    return 10n ** 18n;
  }
  async getCode(a: string) {
    return a === TOKEN ? "0x6001" : "0x";
  }
  async getTransactionCount() {
    return 1;
  }
  async ethCall() {
    return { success: true, returnData: "0x", revertReason: null };
  }
  async estimateGas() {
    return 60_000n;
  }
  async traceCall() {
    return null;
  }
  async erc20BalanceOf() {
    return 1_000_000n;
  }
  async erc20Meta() {
    return { symbol: "USDC", decimals: 6 };
  }
}

function build() {
  const config = loadConfig({
    MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
    MONAD_NETWORK: "testnet",
    MONAD_USDC_ADDRESS: TOKEN,
    NODE_ENV: "test",
    LOG_LEVEL: "fatal",
    DELTAG_RATE_LIMIT_MAX: "0",
  } as NodeJS.ProcessEnv);
  return buildApp(config, { createRpc: () => new MockRpc() });
}

describe("HTTP API", () => {
  it("GET /health", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", chainId: 10143 });
    await app.close();
  });

  it("POST /v1/analyze flags unlimited approval", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/v1/analyze",
      payload: {
        network: "testnet",
        transaction: {
          from: USER,
          to: TOKEN,
          maxFeePerGas: "60000000000",
          data: ERC20.encodeFunctionData("approve", [SPENDER, UINT256_MAX]),
        },
        userWallet: USER,
        policy: { blockUnlimitedApprovals: true },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.safe).toBe(false);
    expect(body.riskFindings.map((f: { code: string }) => f.code)).toContain(
      "ERC20_APPROVAL_UNLIMITED",
    );
    await app.close();
  });

  it("POST /v1/analyze rejects malformed body", async () => {
    const app = await build();
    const res = await app.inject({ method: "POST", url: "/v1/analyze", payload: { foo: "bar" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("GET /mcp/tools lists tools", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/mcp/tools" });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools.map((t: { name: string }) => t.name)).toContain("premon_analyze");
    await app.close();
  });

  it("POST /mcp/call premon_list_profiles", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/mcp/call",
      payload: { name: "premon_list_profiles" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.profiles).toHaveLength(3);
    await app.close();
  });

  it("enforces API key when configured", async () => {
    const config = loadConfig({
      MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
      MONAD_NETWORK: "testnet",
      NODE_ENV: "test",
      LOG_LEVEL: "fatal",
      DELTAG_RATE_LIMIT_MAX: "0",
      DELTAG_API_KEYS: "secret-key",
    } as NodeJS.ProcessEnv);
    const app = await buildApp(config, { createRpc: () => new MockRpc() });
    const noKey = await app.inject({ method: "POST", url: "/v1/analyze", payload: {} });
    expect(noKey.statusCode).toBe(401);
    const withKey = await app.inject({
      method: "POST",
      url: "/v1/analyze",
      headers: { authorization: "Bearer secret-key" },
      payload: { network: "testnet", transaction: { from: USER, to: SPENDER, value: "1" } },
    });
    expect(withKey.statusCode).toBe(200);
    await app.close();
  });
});
