import { getAddress, isAddress } from "ethers";
import type { CallNode, CallTrace } from "../domain/call-trace.js";
import { EMPTY_CALL_TRACE } from "../domain/call-trace.js";
import { selectorOf } from "./abi.js";
import type { RawCallFrame } from "../infra/monad-rpc.js";

function norm(addr: string | undefined): string | null {
  if (!addr) return null;
  return isAddress(addr) ? getAddress(addr) : addr;
}

function valueToDecimal(v: string | undefined): string {
  if (!v) return "0";
  try {
    return (v.startsWith("0x") ? BigInt(v) : BigInt(v)).toString();
  } catch {
    return "0";
  }
}

/**
 * Converts a `callTracer` frame tree into Premon's chain-generic `CallTrace`.
 * Returns `EMPTY_CALL_TRACE` when no trace is available (node lacks debug RPC),
 * which downstream maps to "not traced → lower confidence" — the EVM analogue
 * of a Stellar classic-only (non-preflighted) transaction.
 */
export function parseCallTrace(frame: RawCallFrame | null): CallTrace {
  if (!frame) return EMPTY_CALL_TRACE;

  const allContracts = new Set<string>();
  let maxDepth = 0;
  let total = 0;
  let hasDelegateCall = false;
  let hasSelfdestruct = false;

  const walk = (f: RawCallFrame, depth: number): CallNode => {
    total += 1;
    maxDepth = Math.max(maxDepth, depth);
    const callType = (f.type ?? "CALL").toUpperCase();
    if (callType === "DELEGATECALL") hasDelegateCall = true;
    if (callType === "SELFDESTRUCT") hasSelfdestruct = true;

    const to = norm(f.to);
    if (to) allContracts.add(to);

    const node: CallNode = {
      callType,
      from: norm(f.from) ?? "0x",
      to,
      selector: selectorOf(f.input),
      value: valueToDecimal(f.value),
      depth,
      reverted: Boolean(f.error) || Boolean(f.revertReason),
      children: (f.calls ?? []).map((c) => walk(c, depth + 1)),
    };
    return node;
  };

  const root = walk(frame, 0);

  return {
    roots: [root],
    allContractAddresses: [...allContracts],
    maxDepth,
    totalInvocations: total,
    hasDelegateCall,
    hasSelfdestruct,
  };
}
