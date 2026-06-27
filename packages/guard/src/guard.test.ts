import { describe, expect, it } from "vitest";
import { TransactionGuard } from "./guard";
import { GuardBlockedError } from "./errors";
import { STRICT_POLICY } from "./policy";
import type { AnalysisResult } from "./types";

function fakeFetch(result: AnalysisResult): typeof fetch {
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
  riskFindings: [
    { code: "ERC20_APPROVAL_UNLIMITED", severity: "high", message: "unlimited" },
  ],
  simulationWarnings: [],
};

const ALLOWED: AnalysisResult = {
  safe: true,
  reasons: [],
  estimatedChanges: { native: [], assets: [], approvals: [] },
  riskFindings: [{ code: "ERC20_APPROVAL_GRANTED", severity: "medium", message: "ok" }],
  simulationWarnings: [],
};

describe("TransactionGuard", () => {
  it("returns block for an unsafe analysis", async () => {
    const guard = new TransactionGuard({
      network: "testnet",
      analyze: { baseUrl: "http://x", fetchImpl: fakeFetch(BLOCKED) },
    });
    const ev = await guard.evaluate({
      transaction: { from: "0x1", to: "0x2" },
      policy: STRICT_POLICY,
    });
    expect(ev.decision).toBe("block");
    expect(ev.blockingReasons.length).toBeGreaterThan(0);
  });

  it("returns allow + advisory findings for a safe analysis", async () => {
    const guard = new TransactionGuard({
      network: "testnet",
      analyze: { baseUrl: "http://x", fetchImpl: fakeFetch(ALLOWED) },
    });
    const ev = await guard.evaluate({ transaction: "0xdeadbeef", policy: {} });
    expect(ev.decision).toBe("allow");
    expect(ev.advisoryFindings.map((f) => f.code)).toContain("ERC20_APPROVAL_GRANTED");
  });

  it("prepare throws GuardBlockedError on block", async () => {
    const guard = new TransactionGuard({
      network: "testnet",
      analyze: { baseUrl: "http://x", fetchImpl: fakeFetch(BLOCKED) },
    });
    await expect(
      guard.prepare({ transaction: { from: "0x1" }, policy: {} }),
    ).rejects.toBeInstanceOf(GuardBlockedError);
  });
});
