import { describe, expect, it } from "vitest";
import { GuardedWallet } from "./guarded-wallet.js";
import { GuardBlockedError, STRICT_POLICY, type AnalysisResult } from "@premon/guard";

// Hardhat account #0 — test key only.
const TEST_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

function mockFetch(result: AnalysisResult): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

const BLOCKED: AnalysisResult = {
  safe: false,
  reasons: ["Unlimited ERC-20 approval detected and blocked by policy"],
  estimatedChanges: { native: [], assets: [], approvals: [] },
  riskFindings: [{ code: "ERC20_APPROVAL_UNLIMITED", severity: "high", message: "unlimited" }],
  simulationWarnings: [],
};

const ALLOWED: AnalysisResult = {
  safe: true,
  reasons: [],
  estimatedChanges: { native: [], assets: [], approvals: [] },
  riskFindings: [],
  simulationWarnings: [],
};

function wallet(result: AnalysisResult): GuardedWallet {
  return new GuardedWallet({
    privateKey: TEST_PK,
    rpcUrl: "https://testnet-rpc.monad.xyz",
    analyzeUrl: "http://analyzer.test",
    policy: STRICT_POLICY,
    fetchImpl: mockFetch(result),
  });
}

describe("GuardedWallet", () => {
  it("derives the agent address", () => {
    expect(wallet(ALLOWED).address).toBe(TEST_ADDR);
  });

  it("evaluate() reports block for an unsafe tx", async () => {
    const o = await wallet(BLOCKED).evaluate({ to: TEST_ADDR, data: "0x095ea7b3" });
    expect(o.decision).toBe("block");
    expect(o.blockingReasons.length).toBeGreaterThan(0);
  });

  it("sendTransaction() throws GuardBlockedError and never signs on block", async () => {
    await expect(
      wallet(BLOCKED).sendTransaction({ to: TEST_ADDR, data: "0x095ea7b3" }),
    ).rejects.toBeInstanceOf(GuardBlockedError);
  });

  it("evaluate() reports allow for a safe tx", async () => {
    const o = await wallet(ALLOWED).evaluate({ to: TEST_ADDR, value: 1n });
    expect(o.decision).toBe("allow");
  });
});
