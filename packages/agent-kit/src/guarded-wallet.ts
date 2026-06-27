import {
  JsonRpcProvider,
  Wallet,
  toBeHex,
  type TransactionRequest,
  type TransactionResponse,
} from "ethers";
import {
  TransactionGuard,
  GuardBlockedError,
  BALANCED_POLICY,
  type GuardPolicy,
  type MonadNetwork,
  type AnalysisResult,
  type RiskFinding,
  type TransactionInput,
} from "@premon/guard";

export interface GuardedWalletConfig {
  /** Agent private key (0x…). Keep it in an env var / secret manager. */
  privateKey: string;
  /** Monad JSON-RPC endpoint. */
  rpcUrl: string;
  /** Premon analyzer base URL (e.g. https://premon-api.onrender.com or .../api). */
  analyzeUrl: string;
  /** Bearer key for the analyzer, if it requires one. */
  apiKey?: string;
  /** Network label; default "testnet". */
  network?: MonadNetwork;
  /** Policy enforced before every send; default BALANCED_POLICY. */
  policy?: GuardPolicy;
  /** Override fetch (tests / non-global-fetch runtimes). */
  fetchImpl?: typeof fetch;
}

export interface GuardOutcome {
  decision: "allow" | "block";
  blockingReasons: string[];
  advisoryFindings: RiskFinding[];
  analysis: AnalysisResult;
}

/**
 * A drop-in ethers wallet for agents / programs that routes every transaction
 * through Premon's pre-sign firewall. If the active policy blocks the tx, it
 * throws `GuardBlockedError` and **never signs** — so a compromised prompt,
 * tool, or dependency can't drain the agent's wallet.
 *
 * ```ts
 * const agent = new GuardedWallet({
 *   privateKey: process.env.AGENT_KEY!,
 *   rpcUrl: "https://testnet-rpc.monad.xyz",
 *   analyzeUrl: "https://premon-api.onrender.com",
 *   policy: STRICT_POLICY,
 * });
 * await agent.sendTransaction({ to, data }); // blocked if it violates policy
 * ```
 */
export class GuardedWallet {
  readonly address: string;
  readonly policy: GuardPolicy;
  readonly network: MonadNetwork;
  private readonly wallet: Wallet;
  private readonly provider: JsonRpcProvider;
  private readonly guard: TransactionGuard;

  constructor(cfg: GuardedWalletConfig) {
    this.provider = new JsonRpcProvider(cfg.rpcUrl);
    this.wallet = new Wallet(cfg.privateKey, this.provider);
    this.address = this.wallet.address;
    this.network = cfg.network ?? "testnet";
    this.policy = cfg.policy ?? BALANCED_POLICY;
    this.guard = new TransactionGuard({
      network: this.network,
      analyze: { baseUrl: cfg.analyzeUrl, apiKey: cfg.apiKey, fetchImpl: cfg.fetchImpl },
    });
  }

  /** Run Premon analysis + policy on a tx WITHOUT signing (dry run). */
  async evaluate(tx: TransactionRequest): Promise<GuardOutcome> {
    const ev = await this.guard.evaluate({
      transaction: toGuardTx(tx, this.address),
      userWallet: this.address,
      policy: this.policy,
    });
    return {
      decision: ev.decision,
      blockingReasons: ev.blockingReasons,
      advisoryFindings: ev.advisoryFindings,
      analysis: ev.analysis,
    };
  }

  /**
   * Guarded send: analyze first; if the policy blocks, throw GuardBlockedError
   * and never sign. Otherwise sign + broadcast and return the tx response.
   */
  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const outcome = await this.evaluate(tx);
    if (outcome.decision === "block") {
      throw new GuardBlockedError(
        outcome.blockingReasons[0] ?? "Premon policy blocked this transaction",
        outcome.analysis,
        outcome.blockingReasons,
      );
    }
    return this.wallet.sendTransaction(tx);
  }

  /** The underlying provider (read-only chain access). */
  getProvider(): JsonRpcProvider {
    return this.provider;
  }

  /**
   * The raw ethers signer — bypasses the guard. Use ONLY for flows you have
   * deliberately decided not to protect.
   */
  unsafeSigner(): Wallet {
    return this.wallet;
  }
}

function toGuardTx(tx: TransactionRequest, from: string): TransactionInput {
  return {
    from,
    to: tx.to != null ? String(tx.to) : undefined,
    value: tx.value != null ? toBeHex(tx.value) : undefined,
    data: tx.data != null ? String(tx.data) : undefined,
  };
}
