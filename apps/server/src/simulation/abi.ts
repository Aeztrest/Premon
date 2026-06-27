import { Interface, getAddress, isAddress } from "ethers";

/**
 * Known calldata signatures Premon decodes to understand transaction intent.
 * This is the EVM analogue of the Stellar instruction decoder's op taxonomy:
 * instead of XDR ops we recognise 4-byte selectors of the token / NFT / access
 * primitives that carry the bulk of EVM wallet-drain risk.
 */
export const KNOWN_ABI = new Interface([
  // ERC-20
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function approve(address spender, uint256 amount)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  // ERC-721 / ERC-1155
  "function setApprovalForAll(address operator, bool approved)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  // Ownable / access control
  "function transferOwnership(address newOwner)",
  // Read methods (used for token metadata + balances)
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/** uint256 max — the canonical "unlimited" ERC-20 approval sentinel. */
export const UINT256_MAX = 2n ** 256n - 1n;
/** Approvals at or above 2^255 are treated as effectively unlimited. */
export const UNLIMITED_APPROVAL_THRESHOLD = 2n ** 255n;

export type DecodedCall = {
  /** Function name, e.g. `"approve"`. */
  name: string;
  /** 4-byte selector, e.g. `"0x095ea7b3"`. */
  selector: string;
  /** Decoded positional args (addresses checksummed, uints as bigint). */
  args: readonly unknown[];
  /** Named arg map when the fragment has named inputs. */
  named: Record<string, unknown>;
};

/** Returns the 4-byte selector of calldata, or null when data is empty. */
export function selectorOf(data: string | null | undefined): string | null {
  if (!data) return null;
  const hex = data.startsWith("0x") ? data : `0x${data}`;
  if (hex.length < 10) return null;
  return hex.slice(0, 10).toLowerCase();
}

/**
 * Decodes calldata against the known ABI. Returns null when the selector is
 * unrecognised (an arbitrary contract call we cannot semantically classify).
 */
export function decodeKnownCall(data: string | null | undefined): DecodedCall | null {
  if (!data || data === "0x") return null;
  const hex = data.startsWith("0x") ? data : `0x${data}`;
  let parsed;
  try {
    parsed = KNOWN_ABI.parseTransaction({ data: hex });
  } catch {
    return null;
  }
  if (!parsed) return null;

  const named: Record<string, unknown> = {};
  parsed.fragment.inputs.forEach((input, i) => {
    if (input.name) named[input.name] = parsed.args[i];
  });

  return {
    name: parsed.name,
    selector: parsed.selector.toLowerCase(),
    args: parsed.args,
    named,
  };
}

/** Best-effort address normaliser; returns null on invalid input. */
export function asAddress(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return isAddress(v) ? getAddress(v) : null;
}
