import { TransactionGuard } from "@premon/guard";
import { ACTIVE_NETWORK } from "../wallet/connection";

/**
 * Base URL of the PREMON analyze service. Defaults to the local dev server;
 * production builds override via VITE_ANALYZE_URL.
 */
export const ANALYZE_URL =
  (import.meta.env.VITE_ANALYZE_URL as string | undefined) ?? "http://localhost:8080";

/**
 * Bearer key for the analyze endpoint. The default matches the dev server's
 * DELTAG_API_KEYS=dev-key-change-me — production deployments should override.
 */
const API_KEY =
  (import.meta.env.VITE_PREMON_API_KEY as string | undefined) ?? "dev-key-change-me";

let cached: TransactionGuard | null = null;

export function getGuard(): TransactionGuard {
  if (cached) return cached;
  cached = new TransactionGuard({
    analyze: { baseUrl: ANALYZE_URL, apiKey: API_KEY },
    network: ACTIVE_NETWORK,
  });
  return cached;
}
