import type { AppConfig } from "../config/index.js";
import type {
  AssetBalance,
  CallTraceEvent,
  NormalizedSimulation,
  SimulationAccountState,
} from "../domain/simulation-normalized.js";
import type { CallTrace, CallNode } from "../domain/call-trace.js";
import type { MonadRpc } from "../infra/monad-rpc.js";
import type { DecodedEvmTx } from "./tx-decode.js";
import type { TxAddressSet } from "./account-keys.js";
import { parseCallTrace } from "./parse-call-trace.js";

export type SimulateInput = {
  tx: DecodedEvmTx;
  addressSet: TxAddressSet;
  /** Addresses to build pre-state for (already capped). */
  accountAddresses: string[];
};

export type SimulateOutput = {
  simulation: NormalizedSimulation;
  callTrace: CallTrace;
};

/** Caps the address pre-state set, mirroring Stellar's pickAccountsForSimulation. */
export function pickAccountsForSimulation(
  addresses: string[],
  max: number,
): string[] {
  const distinct = [...new Set(addresses)];
  return distinct.slice(0, max);
}

export class EvmSimulator {
  constructor(
    private readonly config: AppConfig,
    private readonly getRpc: () => MonadRpc,
  ) {}

  async simulate(input: SimulateInput): Promise<SimulateOutput> {
    const rpc = this.getRpc();
    const { tx, addressSet, accountAddresses } = input;

    const ethCallTx = {
      from: tx.from,
      to: tx.to,
      data: tx.data,
      value: tx.value,
    };

    // Fire pre-state + execution + trace concurrently.
    const [accounts, callResult, gasUsedRaw, rawTrace] = await Promise.all([
      this.buildPreState(rpc, accountAddresses, addressSet.tokens, tx.from),
      rpc.ethCall(ethCallTx),
      rpc.estimateGas(ethCallTx),
      rpc.traceCall(ethCallTx),
    ]);

    const traced = rawTrace != null;
    const callTrace = parseCallTrace(rawTrace);
    const callEvents = flattenCallTrace(callTrace);

    const effectiveGasPrice = tx.effectiveGasPriceWei;
    const gasUsed = gasUsedRaw ?? tx.gasLimit;
    const gasFeeWei =
      gasUsed != null && effectiveGasPrice != null
        ? (gasUsed * effectiveGasPrice).toString()
        : null;

    const common = {
      callEvents,
      accounts,
      gasFeeWei,
      gasUsed: gasUsed != null ? gasUsed.toString() : null,
      gasPriceWei: effectiveGasPrice != null ? effectiveGasPrice.toString() : null,
      traced,
    };

    const simulation: NormalizedSimulation = callResult.success
      ? { ...common, status: "success", err: null }
      : {
          ...common,
          status: "failed",
          err: callResult.revertReason ?? "execution reverted",
        };

    return { simulation, callTrace };
  }

  private async buildPreState(
    rpc: MonadRpc,
    addresses: string[],
    tokens: string[],
    from: string | null,
  ): Promise<SimulationAccountState[]> {
    // Token metadata fetched once per token.
    const tokenMeta = new Map<
      string,
      { symbol: string | null; decimals: number | null }
    >();
    await Promise.all(
      tokens.map(async (t) => {
        tokenMeta.set(t, await rpc.erc20Meta(t));
      }),
    );

    return Promise.all(
      addresses.map(async (address) => {
        const [balance, code, nonce] = await Promise.all([
          rpc.getBalance(address),
          rpc.getCode(address),
          from && address === from
            ? rpc.getTransactionCount(address)
            : Promise.resolve(null),
        ]);
        const isContract = code != null && code !== "0x";

        // ERC-20 balances for this address across the touched tokens.
        const balances: AssetBalance[] = [];
        for (const token of tokens) {
          if (token === address) continue;
          const bal = await rpc.erc20BalanceOf(token, address);
          if (bal == null) continue;
          const meta = tokenMeta.get(token);
          balances.push({
            assetCode: meta?.symbol ?? "",
            assetIssuer: token,
            assetType: "erc20",
            balance: bal.toString(),
            decimals: meta?.decimals ?? 18,
          });
        }

        const exists =
          isContract || balance > 0n || (nonce != null && nonce > 0);

        return {
          accountId: address,
          exists,
          nativeBalance: balance.toString(),
          isContract,
          balances,
          nonce: nonce != null ? String(nonce) : null,
        };
      }),
    );
  }
}

function flattenCallTrace(trace: CallTrace): CallTraceEvent[] {
  const out: CallTraceEvent[] = [];
  const walk = (node: CallNode): void => {
    out.push({
      callType: node.callType,
      from: node.from,
      to: node.to,
      value: node.value,
      selector: node.selector,
      reverted: node.reverted,
    });
    node.children.forEach(walk);
  };
  trace.roots.forEach(walk);
  return out;
}
