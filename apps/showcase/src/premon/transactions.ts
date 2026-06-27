/**
 * Showcase demo transaction builders (Monad / EVM build).
 *
 * Each scenario produces a different EVM tx-request shape so Premon's policy
 * gate has something distinct to evaluate. Safe scenarios use plain native
 * (MON) transfers or ordinary contract calls; danger scenarios reach for the
 * common EVM attack primitives — unlimited ERC-20 `approve`, NFT
 * `setApprovalForAll`, native transfers to known-malicious addresses, and
 * calls that revert in simulation.
 *
 * The returned tx-request is unsigned; the demo wallet signs + submits (or,
 * when `Sign with Premon` is chosen, the wallet popup signs after running the
 * same analyze pipeline a second time as the authoritative gatekeeper).
 *
 * Token/contract addresses are plausible 0x placeholders — recognizable as
 * untrusted because they're not on any known-safe allowlist.
 */

import { Interface, MaxUint256, parseEther, parseUnits } from "ethers";
import type { TxRequest } from "@premon/wallet-adapter";

export type ScenarioId =
  | "novaswap-safe"
  | "novaswap-danger"
  | "pixeldrop-safe"
  | "pixeldrop-danger"
  | "orbityield-safe"
  | "orbityield-warn"
  | "claimhub-safe"
  | "claimhub-danger"
  | "launchpad-safe"
  | "launchpad-danger";

/** Monad testnet chain id. */
const MONAD_CHAIN_ID = 10143;

/** USDC has 6 decimals on Monad (mirrors the server config). */
const USDC_DECIMALS = 6;

/** Build a valid all-lowercase 20-byte address from a short hex prefix. */
const addr = (prefix: string): string => "0x" + prefix.padEnd(40, "0");

// USDC token contract (placeholder, Monad testnet).
const USDC_TOKEN = "0x534b2f3A21130d7a60830c2Df862319e593943A3";

// Synthetic contract / token addresses for danger scenarios. None of these are
// on a known-safe allowlist, so the analyzer flags them as unknown exposure.
const FAKE_DEX_TOKEN = addr("de50a1");
const FAKE_DRAINER_SPENDER = addr("bad");
const FAKE_NFT_COLLECTION = addr("c0ffee");
const FAKE_NFT_OPERATOR = addr("0eca57");
const FAKE_STAKING_CONTRACT = addr("5ada11");
const FAKE_CLAIM_CONTRACT = addr("c1a1d");
const FAKE_LAUNCH_CONTRACT = addr("1a0c4");

// Synthetic attacker EOA for the malicious-transfer danger scenario.
const ATTACKER_ADDRESS = "0xdead00000000000000000000000000000000beef";

/* ───── ABIs (only the selectors we encode) ───── */

const ERC20 = new Interface([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
]);

const ERC721 = new Interface([
  "function setApprovalForAll(address operator, bool approved)",
]);

const STAKING = new Interface([
  "function deposit(uint256 amount)",
]);

const CLAIM = new Interface([
  "function claim(uint256 amount)",
]);

const LAUNCH = new Interface([
  "function buy(uint256 amount)",
  // A function the honeypot launch contract does not implement → reverts.
  "function commit(uint256 amount, bytes32 proof)",
]);

export interface BuiltScenario {
  /** Unsigned EVM transaction request. */
  transaction: TxRequest;
  /** Short human description rendered in the RiskPreview hero. */
  label: string;
}

/**
 * Build the candidate transaction for a given scenario. `userWallet` is the
 * connected EOA (`0x…`) — used as the tx `from` and, where relevant, as the
 * recipient of safe self-transfers.
 */
export async function buildScenario(
  scenario: ScenarioId,
  userWallet: string,
): Promise<BuiltScenario> {
  const from = userWallet;

  switch (scenario) {
    /* ── NovaSwap ── */
    case "novaswap-safe":
      return {
        transaction: tx(from, userWallet, parseEther("0.0001")),
        label: "NovaSwap: 0.0001 MON self-transfer quote",
      };
    case "novaswap-danger":
      // Unlimited ERC-20 approve to a stranger contract — the classic drainer.
      return {
        transaction: call(
          from,
          FAKE_DEX_TOKEN,
          ERC20.encodeFunctionData("approve", [FAKE_DRAINER_SPENDER, MaxUint256]),
        ),
        label: "NovaSwap: unlimited ERC-20 approve to a stranger contract",
      };

    /* ── PixelDrop ── */
    case "pixeldrop-safe":
      // Ordinary ERC-20 transfer (the mint fee).
      return {
        transaction: call(
          from,
          USDC_TOKEN,
          ERC20.encodeFunctionData("transfer", [
            userWallet,
            parseUnits("0.001", USDC_DECIMALS),
          ]),
        ),
        label: "PixelDrop: 0.001 USDC transfer (mint fee)",
      };
    case "pixeldrop-danger":
      // setApprovalForAll grants an operator your entire NFT collection.
      return {
        transaction: call(
          from,
          FAKE_NFT_COLLECTION,
          ERC721.encodeFunctionData("setApprovalForAll", [
            FAKE_NFT_OPERATOR,
            true,
          ]),
        ),
        label: "PixelDrop: setApprovalForAll hands an operator your whole NFT collection",
      };

    /* ── OrbitYield ── */
    case "orbityield-safe":
      // Deposit into an unverified staking contract — unknown contract exposure.
      return {
        transaction: call(
          from,
          FAKE_STAKING_CONTRACT,
          STAKING.encodeFunctionData("deposit", [parseEther("1")]),
          parseEther("1"),
        ),
        label: "OrbitYield: deposit 1 MON into staking",
      };
    case "orbityield-warn":
      // High-value native transfer into the same unverified contract.
      return {
        transaction: call(
          from,
          FAKE_STAKING_CONTRACT,
          STAKING.encodeFunctionData("deposit", [parseEther("100")]),
          parseEther("100"),
        ),
        label: "OrbitYield: deposit 100 MON (large native transfer)",
      };

    /* ── ClaimHub ── */
    case "claimhub-safe":
      // Ordinary claim call.
      return {
        transaction: call(
          from,
          FAKE_CLAIM_CONTRACT,
          CLAIM.encodeFunctionData("claim", [parseUnits("0.1", USDC_DECIMALS)]),
        ),
        label: "ClaimHub: claim 0.1 USDC airdrop",
      };
    case "claimhub-danger":
      // Native transfer of (almost) the entire balance to a known-malicious
      // address — the drainer endgame.
      return {
        transaction: tx(from, ATTACKER_ADDRESS, parseEther("9.9")),
        label: "ClaimHub: native transfer to a known-malicious address — drains your balance",
      };

    /* ── LaunchPad ── */
    case "launchpad-safe":
      // Presale buy on the (vetted) launch contract.
      return {
        transaction: call(
          from,
          FAKE_LAUNCH_CONTRACT,
          LAUNCH.encodeFunctionData("buy", [parseEther("0.5")]),
          parseEther("0.5"),
        ),
        label: "LaunchPad: 0.5 MON presale allocation",
      };
    case "launchpad-danger":
      // Honeypot rug: the contract advertises a presale but this call reverts
      // in simulation — your funds would be taken on a path that never returns
      // the token.
      return {
        transaction: call(
          from,
          FAKE_LAUNCH_CONTRACT,
          LAUNCH.encodeFunctionData("commit", [
            parseEther("500"),
            "0x" + "00".repeat(32),
          ]),
          parseEther("500"),
        ),
        label: "LaunchPad: presale buy reverts in simulation (honeypot rug)",
      };
  }
}

/** A plain native-value transfer. */
function tx(from: string, to: string, value: bigint): TxRequest {
  return { from, to, value: value.toString(), chainId: MONAD_CHAIN_ID };
}

/** A contract call with optional native value. */
function call(
  from: string,
  to: string,
  data: string,
  value: bigint = 0n,
): TxRequest {
  return {
    from,
    to,
    data,
    value: value.toString(),
    chainId: MONAD_CHAIN_ID,
  };
}
