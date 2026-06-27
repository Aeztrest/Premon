import type {
  ApprovalChange,
  AssetBalanceChange,
  EstimatedChanges,
  NativeBalanceChange,
} from "../domain/estimated-changes.js";
import type { NormalizedSimulation, SimulationAccountState } from "../domain/simulation-normalized.js";
import type { DecodedEvmTx } from "../simulation/tx-decode.js";
import { decodeKnownCall, asAddress, UNLIMITED_APPROVAL_THRESHOLD } from "../simulation/abi.js";

export function buildPreAccountsMap(
  accounts: SimulationAccountState[],
): Map<string, SimulationAccountState> {
  const map = new Map<string, SimulationAccountState>();
  for (const a of accounts) map.set(a.accountId, a);
  return map;
}

function preNative(map: Map<string, SimulationAccountState>, addr: string): bigint | null {
  const a = map.get(addr);
  if (!a) return null;
  try {
    return BigInt(a.nativeBalance);
  } catch {
    return null;
  }
}

function preToken(
  map: Map<string, SimulationAccountState>,
  addr: string,
  token: string,
): { balance: bigint | null; decimals: number; symbol: string } {
  const a = map.get(addr);
  const row = a?.balances.find((b) => b.assetIssuer === token);
  if (!row) return { balance: null, decimals: 18, symbol: "" };
  let bal: bigint | null = null;
  try {
    bal = BigInt(row.balance);
  } catch {
    bal = null;
  }
  return { balance: bal, decimals: row.decimals, symbol: row.assetCode };
}

/**
 * Projects estimated balance / approval changes from the decoded transaction
 * intent and the pre-state snapshot. Without a full execution trace (logs +
 * post-state), EVM deltas are derived from calldata semantics — the same
 * "op-shape projection" model the Stellar build uses for classic-only txs.
 * The accompanying LOW_CONFIDENCE finding flags that distinction.
 */
export function extractEstimatedChanges(
  preMap: Map<string, SimulationAccountState>,
  simulation: NormalizedSimulation,
  tx: DecodedEvmTx,
  userWallet: string | null,
): EstimatedChanges {
  void userWallet;
  const native: NativeBalanceChange[] = [];
  const assets: AssetBalanceChange[] = [];
  const approvals: ApprovalChange[] = [];

  const gasFee = simulation.gasFeeWei ? safeBig(simulation.gasFeeWei) : 0n;
  const decoded = tx.data !== "0x" ? decodeKnownCall(tx.data) : null;

  // ── Native MON deltas ────────────────────────────────────────────────
  if (tx.from) {
    const pre = preNative(preMap, tx.from);
    const delta = -(tx.value + gasFee);
    native.push({
      accountId: tx.from,
      preWei: pre != null ? pre.toString() : null,
      postWei: pre != null ? (pre + delta).toString() : null,
      deltaWei: delta.toString(),
    });
  }
  if (tx.to && tx.value > 0n) {
    const pre = preNative(preMap, tx.to);
    native.push({
      accountId: tx.to,
      preWei: pre != null ? pre.toString() : null,
      postWei: pre != null ? (pre + tx.value).toString() : null,
      deltaWei: tx.value.toString(),
    });
  }

  // ── ERC-20 transfer deltas ───────────────────────────────────────────
  if (decoded && tx.to) {
    const token = tx.to;
    if (decoded.name === "transfer") {
      const to = asAddress(decoded.named.to);
      const amount = asBig(decoded.named.amount);
      if (tx.from && amount != null) pushAsset(assets, preMap, token, tx.from, -amount);
      if (to && amount != null) pushAsset(assets, preMap, token, to, amount);
    } else if (decoded.name === "transferFrom") {
      const from = asAddress(decoded.named.from);
      const to = asAddress(decoded.named.to);
      const amount = asBig(decoded.named.amount);
      if (from && amount != null) pushAsset(assets, preMap, token, from, -amount);
      if (to && amount != null) pushAsset(assets, preMap, token, to, amount);
    }
  }

  // ── Approval grants (ERC-20 approve / permit / setApprovalForAll) ─────
  if (decoded && tx.to) {
    const token = tx.to;
    const { symbol } = preToken(preMap, token, token);
    if (decoded.name === "approve") {
      const spender = asAddress(decoded.named.spender);
      const amount = asBig(decoded.named.amount) ?? 0n;
      if (spender) {
        approvals.push(buildApproval(token, symbol, tx.from, spender, amount));
      }
    } else if (decoded.name === "permit") {
      const owner = asAddress(decoded.named.owner);
      const spender = asAddress(decoded.named.spender);
      const amount = asBig(decoded.named.value) ?? 0n;
      if (spender) {
        approvals.push(buildApproval(token, symbol, owner ?? tx.from, spender, amount));
      }
    } else if (decoded.name === "setApprovalForAll") {
      const operator = asAddress(decoded.named.operator);
      const approved = Boolean(decoded.named.approved);
      if (operator) {
        approvals.push({
          kind: "approval_for_all",
          tokenAddress: token,
          tokenSymbol: symbol,
          owner: tx.from ?? "",
          spender: operator,
          amount: approved ? "1" : "0",
          unlimited: approved,
          message: approved
            ? `Grants operator ${operator} approval for ALL tokens in collection ${token}.`
            : `Revokes operator ${operator} for collection ${token}.`,
        });
      }
    }
  }

  return { native, assets, approvals };
}

function buildApproval(
  token: string,
  symbol: string,
  owner: string | null,
  spender: string,
  amount: bigint,
): ApprovalChange {
  const unlimited = amount >= UNLIMITED_APPROVAL_THRESHOLD;
  return {
    kind: "erc20_approval",
    tokenAddress: token,
    tokenSymbol: symbol,
    owner: owner ?? "",
    spender,
    amount: amount.toString(),
    unlimited,
    message: unlimited
      ? `Grants UNLIMITED ${symbol || "token"} allowance to ${spender}.`
      : `Grants ${amount.toString()} ${symbol || "token"} allowance to ${spender}.`,
  };
}

function pushAsset(
  out: AssetBalanceChange[],
  preMap: Map<string, SimulationAccountState>,
  token: string,
  account: string,
  delta: bigint,
): void {
  const { balance, decimals, symbol } = preToken(preMap, account, token);
  const pre = balance ?? 0n;
  out.push({
    accountId: account,
    asset: token,
    assetCode: symbol,
    assetIssuer: token,
    preBalance: balance != null ? pre.toString() : "0",
    postBalance: (pre + delta).toString(),
    delta: delta.toString(),
    decimals,
  });
}

function safeBig(s: string): bigint {
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}

function asBig(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") {
    try {
      return BigInt(v);
    } catch {
      return null;
    }
  }
  return null;
}
