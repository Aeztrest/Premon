import { AnalyzeError } from "./errors.js";
import { normalizePolicy, type GuardPolicy } from "./policy.js";
import type { AnalysisResult, MonadNetwork, TransactionInput } from "./types.js";

export interface AnalyzeClientConfig {
  /** Base URL of the Premon server, e.g. http://localhost:8080 */
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface AnalyzeRequest {
  network: MonadNetwork;
  /** Raw 0x-hex serialized tx OR a tx-request object. */
  transaction: TransactionInput;
  /** User's 0x address (for balance attribution). */
  userWallet?: string;
  policy: GuardPolicy;
  integratorRequestId?: string;
  paymentRequirements?: {
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: Record<string, unknown>;
  };
}

const DEFAULT_TIMEOUT = 15_000;

export async function analyzeTransaction(
  cfg: AnalyzeClientConfig,
  req: AnalyzeRequest,
): Promise<AnalysisResult> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/v1/analyze`;
  const fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new AnalyzeError("No fetch implementation available in this environment");
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), cfg.timeoutMs ?? DEFAULT_TIMEOUT);

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;

    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        network: req.network,
        transaction: req.transaction,
        userWallet: req.userWallet,
        policy: normalizePolicy(req.policy),
        integratorRequestId: req.integratorRequestId,
        paymentRequirements: req.paymentRequirements,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let body = "";
      try {
        body = await res.text();
      } catch {
        /* ignore */
      }
      throw new AnalyzeError(`Premon analyze returned HTTP ${res.status}`, res.status, body);
    }

    return (await res.json()) as AnalysisResult;
  } catch (err) {
    if (err instanceof AnalyzeError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new AnalyzeError(
        `Premon analyze timed out after ${cfg.timeoutMs ?? DEFAULT_TIMEOUT}ms`,
        undefined,
        undefined,
        err,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new AnalyzeError(`Premon analyze request failed: ${msg}`, undefined, undefined, err);
  } finally {
    clearTimeout(t);
  }
}
