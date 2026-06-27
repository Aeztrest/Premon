import { JsonRpcProvider, Network, FetchRequest } from "ethers";
import type { AppConfig } from "../config/index.js";
import { KNOWN_ABI } from "../simulation/abi.js";

export type EthCallTx = {
  from?: string | null;
  to?: string | null;
  data?: string | null;
  value?: bigint | null;
};

export type EthCallResult = {
  success: boolean;
  returnData: string;
  revertReason: string | null;
};

/** Raw `callTracer` frame shape as returned by `debug_traceCall`. */
export type RawCallFrame = {
  type: string;
  from: string;
  to?: string;
  value?: string;
  gas?: string;
  gasUsed?: string;
  input?: string;
  output?: string;
  error?: string;
  revertReason?: string;
  calls?: RawCallFrame[];
};

/**
 * The minimal RPC surface the simulator needs. Defined as an interface so the
 * pipeline can be driven by a mock in tests without a live Monad node — the
 * same role `StellarRpcAdapter` played for Horizon/Soroban.
 */
export interface MonadRpc {
  getChainId(): Promise<number>;
  getBalance(address: string): Promise<bigint>;
  getCode(address: string): Promise<string>;
  getTransactionCount(address: string): Promise<number>;
  ethCall(tx: EthCallTx): Promise<EthCallResult>;
  estimateGas(tx: EthCallTx): Promise<bigint | null>;
  /** Returns the callTracer frame, or null when the node does not support debug_traceCall. */
  traceCall(tx: EthCallTx): Promise<RawCallFrame | null>;
  erc20BalanceOf(token: string, owner: string): Promise<bigint | null>;
  erc20Meta(token: string): Promise<{ symbol: string | null; decimals: number | null }>;
}

export class MonadRpcError extends Error {
  constructor(
    public readonly code: "RPC_UNAVAILABLE" | "RPC_TIMEOUT" | "RPC_BAD_RESPONSE",
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "MonadRpcError";
  }
}

function extractRevertReason(err: unknown): string | null {
  if (typeof err !== "object" || err == null) return null;
  const e = err as Record<string, unknown>;
  if (typeof e.reason === "string" && e.reason) return e.reason;
  const revert = e.revert as { args?: unknown[] } | undefined;
  if (revert?.args && revert.args.length > 0 && typeof revert.args[0] === "string") {
    return revert.args[0];
  }
  if (typeof e.shortMessage === "string") return e.shortMessage;
  return null;
}

function isCallException(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err != null &&
    (err as Record<string, unknown>).code === "CALL_EXCEPTION"
  );
}

/** ethers-backed Monad JSON-RPC adapter. */
export class MonadRpcAdapter implements MonadRpc {
  private readonly provider: JsonRpcProvider;
  private traceSupported: boolean | null = null;

  constructor(private readonly config: AppConfig) {
    const req = new FetchRequest(config.monad.rpcUrl);
    req.timeout = config.requestTimeoutMs;
    const network = new Network(config.monad.network, config.monad.chainId);
    this.provider = new JsonRpcProvider(req, network, {
      staticNetwork: network,
    });
  }

  async getChainId(): Promise<number> {
    const net = await this.provider.getNetwork();
    return Number(net.chainId);
  }

  async getBalance(address: string): Promise<bigint> {
    return this.provider.getBalance(address);
  }

  async getCode(address: string): Promise<string> {
    return this.provider.getCode(address);
  }

  async getTransactionCount(address: string): Promise<number> {
    return this.provider.getTransactionCount(address);
  }

  async ethCall(tx: EthCallTx): Promise<EthCallResult> {
    try {
      const returnData = await this.provider.call({
        from: tx.from ?? undefined,
        to: tx.to ?? undefined,
        data: tx.data ?? undefined,
        value: tx.value ?? undefined,
      });
      return { success: true, returnData, revertReason: null };
    } catch (err) {
      if (isCallException(err)) {
        return {
          success: false,
          returnData: "0x",
          revertReason: extractRevertReason(err) ?? "execution reverted",
        };
      }
      throw new MonadRpcError(
        "RPC_UNAVAILABLE",
        `eth_call failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  async estimateGas(tx: EthCallTx): Promise<bigint | null> {
    try {
      return await this.provider.estimateGas({
        from: tx.from ?? undefined,
        to: tx.to ?? undefined,
        data: tx.data ?? undefined,
        value: tx.value ?? undefined,
      });
    } catch {
      return null;
    }
  }

  async traceCall(tx: EthCallTx): Promise<RawCallFrame | null> {
    if (this.traceSupported === false) return null;
    const callObject: Record<string, string> = { from: tx.from ?? "" };
    if (tx.to) callObject.to = tx.to;
    if (tx.data) callObject.data = tx.data;
    if (tx.value != null) callObject.value = `0x${tx.value.toString(16)}`;
    try {
      const result = (await this.provider.send("debug_traceCall", [
        callObject,
        "latest",
        { tracer: "callTracer" },
      ])) as RawCallFrame;
      this.traceSupported = true;
      return result;
    } catch (err) {
      // Method not available on this node → degrade gracefully, remember it.
      this.traceSupported = false;
      void err;
      return null;
    }
  }

  async erc20BalanceOf(token: string, owner: string): Promise<bigint | null> {
    try {
      const data = KNOWN_ABI.encodeFunctionData("balanceOf", [owner]);
      const ret = await this.provider.call({ to: token, data });
      if (!ret || ret === "0x") return null;
      const [bal] = KNOWN_ABI.decodeFunctionResult("balanceOf", ret);
      return BigInt(bal);
    } catch {
      return null;
    }
  }

  async erc20Meta(
    token: string,
  ): Promise<{ symbol: string | null; decimals: number | null }> {
    let symbol: string | null = null;
    let decimals: number | null = null;
    try {
      const ret = await this.provider.call({
        to: token,
        data: KNOWN_ABI.encodeFunctionData("symbol", []),
      });
      if (ret && ret !== "0x") {
        symbol = String(KNOWN_ABI.decodeFunctionResult("symbol", ret)[0]);
      }
    } catch {
      /* token may not implement symbol() */
    }
    try {
      const ret = await this.provider.call({
        to: token,
        data: KNOWN_ABI.encodeFunctionData("decimals", []),
      });
      if (ret && ret !== "0x") {
        decimals = Number(KNOWN_ABI.decodeFunctionResult("decimals", ret)[0]);
      }
    } catch {
      /* token may not implement decimals() */
    }
    return { symbol, decimals };
  }
}

export function createMonadRpc(config: AppConfig): MonadRpc {
  return new MonadRpcAdapter(config);
}
