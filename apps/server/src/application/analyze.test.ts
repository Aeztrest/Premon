import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
import { loadConfig } from "../config/index.js";
import type { AppConfig } from "../config/index.js";
import type { EthCallResult, MonadRpc, RawCallFrame } from "../infra/monad-rpc.js";
import { UINT256_MAX } from "../simulation/abi.js";
import { analyzeTransaction } from "./analyze-transaction.js";
import type { AnalyzeRequestBody } from "../domain/policy.js";

const ERC20 = new Interface([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
]);

const USER = "0x1111111111111111111111111111111111111111";
const SPENDER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0xf817257fed379853cDe0fa4F97AB987181B1E5Ea";
const DRAINER = "0x0000000000000000000000000000000000000bad"; // in reputation seed

function cfg(): AppConfig {
  return loadConfig({
    MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
    MONAD_NETWORK: "testnet",
    MONAD_USDC_ADDRESS: TOKEN,
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv);
}

class MockRpc implements MonadRpc {
  constructor(
    private readonly o: {
      code?: Record<string, string>;
      bal?: Record<string, bigint>;
      erc20?: Record<string, bigint>;
      call?: EthCallResult;
      trace?: RawCallFrame | null;
    } = {},
  ) {}
  async getChainId() {
    return 10143;
  }
  async getBalance(a: string) {
    return this.o.bal?.[a] ?? 0n;
  }
  async getCode(a: string) {
    return this.o.code?.[a] ?? "0x";
  }
  async getTransactionCount() {
    return 3;
  }
  async ethCall(): Promise<EthCallResult> {
    return this.o.call ?? { success: true, returnData: "0x", revertReason: null };
  }
  async estimateGas() {
    return 60_000n;
  }
  async traceCall() {
    return this.o.trace ?? null;
  }
  async erc20BalanceOf(t: string, owner: string) {
    return this.o.erc20?.[`${t}:${owner}`] ?? null;
  }
  async erc20Meta() {
    return { symbol: "USDC", decimals: 6 };
  }
}

function approveBody(amount: bigint, spender = SPENDER): AnalyzeRequestBody {
  return {
    network: "testnet",
    transaction: {
      from: USER,
      to: TOKEN,
      maxFeePerGas: "60000000000",
      data: ERC20.encodeFunctionData("approve", [spender, amount]),
    },
    policy: {},
    userWallet: USER,
  } as AnalyzeRequestBody;
}

const deps = (rpc: MonadRpc) => ({ config: cfg(), createRpc: () => rpc });

describe("analyzeTransaction (full pipeline)", () => {
  it("flags an unlimited ERC-20 approval and blocks under policy", async () => {
    const rpc = new MockRpc({
      code: { [TOKEN]: "0x6001" },
      bal: { [USER]: 10n ** 18n },
      erc20: { [`${TOKEN}:${USER}`]: 1_000_000n },
    });
    const body = approveBody(UINT256_MAX);
    body.policy = { blockUnlimitedApprovals: true };
    const d = await analyzeTransaction(body, deps(rpc));

    const codes = d.riskFindings.map((f) => f.code);
    expect(codes).toContain("ERC20_APPROVAL_GRANTED");
    expect(codes).toContain("ERC20_APPROVAL_UNLIMITED");
    expect(d.estimatedChanges.approvals[0]?.unlimited).toBe(true);
    expect(d.safe).toBe(false);
    expect(d.annotation?.summary.primaryAction).toBe("erc20_approve");
  });

  it("allows a bounded approval when policy permits", async () => {
    const rpc = new MockRpc({ code: { [TOKEN]: "0x6001" }, bal: { [USER]: 10n ** 18n } });
    const body = approveBody(1_000_000n);
    body.policy = { blockUnlimitedApprovals: true, allowWarnings: true };
    const d = await analyzeTransaction(body, deps(rpc));
    expect(d.riskFindings.map((f) => f.code)).toContain("ERC20_APPROVAL_GRANTED");
    expect(d.riskFindings.map((f) => f.code)).not.toContain("ERC20_APPROVAL_UNLIMITED");
    expect(d.safe).toBe(true);
  });

  it("blocks a tx referencing a known-malicious address (critical, fail-closed)", async () => {
    const rpc = new MockRpc({ code: { [TOKEN]: "0x6001" }, bal: { [USER]: 10n ** 18n } });
    const body = approveBody(1_000_000n, DRAINER);
    body.policy = { allowWarnings: true };
    const d = await analyzeTransaction(body, deps(rpc));
    expect(d.riskFindings.map((f) => f.code)).toContain("KNOWN_MALICIOUS_ADDRESS");
    expect(d.safe).toBe(false);
  });

  it("marks a reverting tx unsafe", async () => {
    const rpc = new MockRpc({
      call: { success: false, returnData: "0x", revertReason: "ERC20: amount exceeds balance" },
    });
    const body = approveBody(1_000_000n);
    body.policy = { allowWarnings: true };
    const d = await analyzeTransaction(body, deps(rpc));
    expect(d.riskFindings.map((f) => f.code)).toContain("SIMULATION_FAILED");
    expect(d.safe).toBe(false);
    expect(d.meta.confidence).toBe("low");
  });

  it("allows a plain native transfer to an EOA", async () => {
    const rpc = new MockRpc({ bal: { [USER]: 10n ** 18n } });
    const body: AnalyzeRequestBody = {
      network: "testnet",
      transaction: { from: USER, to: SPENDER, value: "1000000000000000", maxFeePerGas: "1000000000" },
      policy: { allowWarnings: true },
      userWallet: USER,
    } as AnalyzeRequestBody;
    const d = await analyzeTransaction(body, deps(rpc));
    expect(d.safe).toBe(true);
    expect(d.annotation?.summary.primaryAction).toBe("native_transfer");
    expect(d.estimatedChanges.native.find((n) => n.accountId === USER)?.deltaWei?.startsWith("-")).toBe(true);
  });

  it("blocks setApprovalForAll grant under policy and surfaces a suggestion", async () => {
    const nft = new Interface(["function setApprovalForAll(address operator, bool approved)"]);
    const rpc = new MockRpc({ code: { [TOKEN]: "0x6001" }, bal: { [USER]: 10n ** 18n } });
    const body: AnalyzeRequestBody = {
      network: "testnet",
      transaction: {
        from: USER,
        to: TOKEN,
        data: nft.encodeFunctionData("setApprovalForAll", [SPENDER, true]),
      },
      policy: { blockApprovalForAll: true },
      userWallet: USER,
    } as AnalyzeRequestBody;
    const d = await analyzeTransaction(body, deps(rpc));
    expect(d.riskFindings.map((f) => f.code)).toContain("SET_APPROVAL_FOR_ALL");
    expect(d.safe).toBe(false);
    expect(d.suggestions?.some((s) => s.id === "avoid-approval-for-all")).toBe(true);
  });
});
