import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
import { loadConfig } from "../config/index.js";
import type { AppConfig } from "../config/index.js";
import type { EthCallResult, EthCallTx, MonadRpc, RawCallFrame } from "../infra/monad-rpc.js";
import { decodeTransaction } from "./tx-decode.js";
import { collectTxAddresses } from "./account-keys.js";
import { decodeKnownCall, UINT256_MAX } from "./abi.js";
import { EvmSimulator, pickAccountsForSimulation } from "./evm-simulator.js";

const ERC20 = new Interface([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
]);

const SPENDER = "0x2222222222222222222222222222222222222222";
const USER = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x534b2f3A21130d7a60830c2Df862319e593943A3";

function testConfig(): AppConfig {
  return loadConfig({
    MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
    MONAD_NETWORK: "testnet",
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv);
}

/** A deterministic in-memory RPC so the pipeline runs with no live node. */
class MockRpc implements MonadRpc {
  constructor(
    private readonly opts: {
      code?: Record<string, string>;
      balances?: Record<string, bigint>;
      erc20?: Record<string, bigint>;
      callResult?: EthCallResult;
      trace?: RawCallFrame | null;
    } = {},
  ) {}
  async getChainId() {
    return 10143;
  }
  async getBalance(a: string) {
    return this.opts.balances?.[a] ?? 0n;
  }
  async getCode(a: string) {
    return this.opts.code?.[a] ?? "0x";
  }
  async getTransactionCount() {
    return 1;
  }
  async ethCall(_tx: EthCallTx): Promise<EthCallResult> {
    return this.opts.callResult ?? { success: true, returnData: "0x", revertReason: null };
  }
  async estimateGas() {
    return 50_000n;
  }
  async traceCall() {
    return this.opts.trace ?? null;
  }
  async erc20BalanceOf(token: string, owner: string) {
    return this.opts.erc20?.[`${token}:${owner}`] ?? null;
  }
  async erc20Meta() {
    return { symbol: "USDC", decimals: 6 };
  }
}

describe("tx-decode", () => {
  it("normalizes a tx request object with hex value", () => {
    const decoded = decodeTransaction({
      from: USER,
      to: TOKEN,
      value: "0x0",
      data: ERC20.encodeFunctionData("approve", [SPENDER, UINT256_MAX]),
    });
    expect(decoded.from).toBe(USER);
    expect(decoded.to).toBe(TOKEN);
    expect(decoded.value).toBe(0n);
    expect(decoded.data.slice(0, 10)).toBe("0x095ea7b3");
  });

  it("parses decimal value strings", () => {
    const decoded = decodeTransaction({ from: USER, to: SPENDER, value: "1500000000000000000" });
    expect(decoded.value).toBe(1_500_000_000_000_000_000n);
  });

  it("rejects invalid addresses", () => {
    expect(() => decodeTransaction({ from: "not-an-address" })).toThrow();
  });
});

describe("account-keys", () => {
  it("extracts token + spender from approve calldata", () => {
    const decoded = decodeTransaction({
      from: USER,
      to: TOKEN,
      data: ERC20.encodeFunctionData("approve", [SPENDER, UINT256_MAX]),
    });
    const set = collectTxAddresses(decoded);
    expect(set.tokens).toContain(TOKEN);
    expect(set.assets).toContain(TOKEN);
    expect(set.addresses).toContain(SPENDER);
    expect(set.callTargets).toContain(TOKEN);
  });

  it("marks native asset for plain value transfer", () => {
    const decoded = decodeTransaction({ from: USER, to: SPENDER, value: "1000" });
    const set = collectTxAddresses(decoded);
    expect(set.assets).toContain("native");
    expect(set.tokens).toHaveLength(0);
  });
});

describe("EvmSimulator", () => {
  it("builds a successful simulation with ERC-20 pre-state", async () => {
    const decoded = decodeTransaction({
      from: USER,
      to: TOKEN,
      maxFeePerGas: "60000000000",
      data: ERC20.encodeFunctionData("approve", [SPENDER, UINT256_MAX]),
    });
    const set = collectTxAddresses(decoded);
    const rpc = new MockRpc({
      code: { [TOKEN]: "0x60006000" },
      balances: { [USER]: 5_000_000_000_000_000_000n },
      erc20: { [`${TOKEN}:${USER}`]: 1_000_000n },
    });
    const sim = new EvmSimulator(testConfig(), () => rpc);
    const { simulation } = await sim.simulate({
      tx: decoded,
      addressSet: set,
      accountAddresses: pickAccountsForSimulation(set.addresses, 20),
    });
    expect(simulation.status).toBe("success");
    expect(simulation.traced).toBe(false); // mock returns no trace
    const userState = simulation.accounts.find((a) => a.accountId === USER);
    expect(userState?.nativeBalance).toBe("5000000000000000000");
    expect(userState?.balances[0]?.balance).toBe("1000000");
    expect(simulation.gasFeeWei).toBeTypeOf("string");
  });

  it("marks failed when eth_call reverts", async () => {
    const decoded = decodeTransaction({ from: USER, to: SPENDER, value: "1" });
    const set = collectTxAddresses(decoded);
    const rpc = new MockRpc({
      callResult: { success: false, returnData: "0x", revertReason: "ERC20: insufficient balance" },
    });
    const sim = new EvmSimulator(testConfig(), () => rpc);
    const { simulation } = await sim.simulate({
      tx: decoded,
      addressSet: set,
      accountAddresses: set.addresses,
    });
    expect(simulation.status).toBe("failed");
    if (simulation.status === "failed") {
      expect(simulation.err).toContain("insufficient");
    }
  });

  it("parses a call trace into depth + flags", async () => {
    const decoded = decodeTransaction({ from: USER, to: TOKEN, value: "0" });
    const set = collectTxAddresses(decoded);
    const trace: RawCallFrame = {
      type: "CALL",
      from: USER,
      to: TOKEN,
      value: "0x0",
      input: "0x",
      calls: [
        {
          type: "DELEGATECALL",
          from: TOKEN,
          to: SPENDER,
          input: "0xabcdabcd",
        },
      ],
    };
    const rpc = new MockRpc({ trace });
    const sim = new EvmSimulator(testConfig(), () => rpc);
    const { callTrace, simulation } = await sim.simulate({
      tx: decoded,
      addressSet: set,
      accountAddresses: set.addresses,
    });
    expect(simulation.traced).toBe(true);
    expect(callTrace.maxDepth).toBe(1);
    expect(callTrace.totalInvocations).toBe(2);
    expect(callTrace.hasDelegateCall).toBe(true);
  });
});

describe("abi decode", () => {
  it("recognizes unlimited approve", () => {
    const data = ERC20.encodeFunctionData("approve", [SPENDER, UINT256_MAX]);
    const decoded = decodeKnownCall(data);
    expect(decoded?.name).toBe("approve");
    expect(decoded?.named.spender).toBe(SPENDER);
    expect(decoded?.named.amount).toBe(UINT256_MAX);
  });
});
