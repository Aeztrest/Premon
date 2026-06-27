import { describe, expect, it } from "vitest";
import { Interface, getAddress, parseEther } from "ethers";

describe("ethers capability check", () => {
  it("decodes ERC-20 approve calldata", () => {
    const erc20 = new Interface([
      "function approve(address spender, uint256 amount)",
    ]);
    const max = 2n ** 256n - 1n;
    const data = erc20.encodeFunctionData("approve", [
      "0x1111111111111111111111111111111111111111",
      max,
    ]);
    expect(data.slice(0, 10)).toBe("0x095ea7b3");
    const parsed = erc20.parseTransaction({ data });
    expect(parsed?.name).toBe("approve");
    expect(parsed?.args[1]).toBe(max);
  });

  it("checksums + parses ether", () => {
    expect(getAddress("0x1111111111111111111111111111111111111111")).toMatch(
      /^0x/,
    );
    expect(parseEther("1.5")).toBe(1_500_000_000_000_000_000n);
  });
});
