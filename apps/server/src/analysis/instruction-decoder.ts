import { formatUnits } from "ethers";
import type {
  DecodedOperation,
  OperationAction,
  TransactionSummary,
} from "../domain/instruction-summary.js";
import type { DecodedEvmTx } from "../simulation/tx-decode.js";
import { decodeKnownCall, asAddress, UNLIMITED_APPROVAL_THRESHOLD } from "../simulation/abi.js";

const SELECTOR_TO_ACTION: Record<string, OperationAction> = {
  transfer: "erc20_transfer",
  transferFrom: "erc20_transfer_from",
  approve: "erc20_approve",
  permit: "erc20_permit",
  setApprovalForAll: "nft_set_approval_for_all",
  safeTransferFrom: "nft_transfer",
  transferOwnership: "ownership_transfer",
};

/**
 * Decodes an EVM transaction into a human-readable summary — the EVM analogue
 * of the Stellar instruction decoder. An EVM tx is a single top-level call, so
 * there is normally one operation; the structure stays a list to mirror the
 * Stellar shape and support multicall decoding later.
 */
export function decodeTransactionOperations(tx: DecodedEvmTx): TransactionSummary {
  const involvedContracts = new Set<string>();
  const involvedAssets = new Set<string>();
  const hasData = tx.data !== "0x";

  if (tx.value > 0n) involvedAssets.add("native");

  let action: OperationAction;
  let type: string;
  let description: string;
  const details: Record<string, unknown> = {};

  if (!tx.to) {
    action = "contract_deploy";
    type = "<deploy>";
    description = "Deploys a new contract.";
  } else if (!hasData) {
    action = "native_transfer";
    type = "<native>";
    description = `Send ${formatUnits(tx.value, 18)} MON to ${tx.to}.`;
    details.to = tx.to;
    details.amountWei = tx.value.toString();
  } else {
    if (tx.to) involvedContracts.add(tx.to);
    const decoded = decodeKnownCall(tx.data);
    if (!decoded) {
      action = "contract_call";
      type = tx.data.slice(0, 10);
      description = `Calls contract ${tx.to} (selector ${tx.data.slice(0, 10)}).`;
    } else {
      action = SELECTOR_TO_ACTION[decoded.name] ?? "contract_call";
      type = decoded.name;
      involvedAssets.add(tx.to);
      description = describeCall(decoded.name, decoded.named, tx.to);
      for (const [k, v] of Object.entries(decoded.named)) {
        details[k] = typeof v === "bigint" ? v.toString() : v;
      }
    }
  }

  const op: DecodedOperation = {
    index: 0,
    type,
    source: tx.from,
    action,
    description,
    details,
  };

  return {
    operations: [op],
    humanReadable: description,
    primaryAction: action,
    involvedContracts: [...involvedContracts],
    involvedAssets: [...involvedAssets],
  };
}

function describeCall(
  name: string,
  named: Record<string, unknown>,
  token: string,
): string {
  switch (name) {
    case "approve": {
      const spender = asAddress(named.spender);
      const amount = toBig(named.amount);
      const unlimited = amount != null && amount >= UNLIMITED_APPROVAL_THRESHOLD;
      return unlimited
        ? `Approve UNLIMITED ${token} allowance to ${spender}.`
        : `Approve ${amount?.toString() ?? "?"} of ${token} to ${spender}.`;
    }
    case "transfer":
      return `Transfer ${toBig(named.amount)?.toString() ?? "?"} of ${token} to ${asAddress(named.to)}.`;
    case "transferFrom":
      return `Transfer ${toBig(named.amount)?.toString() ?? "?"} of ${token} from ${asAddress(named.from)} to ${asAddress(named.to)}.`;
    case "permit":
      return `Permit (off-chain approval) of ${token} to ${asAddress(named.spender)}.`;
    case "setApprovalForAll":
      return named.approved
        ? `Grant operator ${asAddress(named.operator)} approval for ALL tokens in ${token}.`
        : `Revoke operator ${asAddress(named.operator)} for ${token}.`;
    case "safeTransferFrom":
      return `Transfer NFT/token from ${asAddress(named.from)} to ${asAddress(named.to)} (${token}).`;
    case "transferOwnership":
      return `Transfer ownership of ${token} to ${asAddress(named.newOwner)}.`;
    default:
      return `Call ${name} on ${token}.`;
  }
}

function toBig(v: unknown): bigint | null {
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
