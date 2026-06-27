/**
 * Inpage entry point. Runs in the page's MAIN world.
 *
 * Installs the Premon EIP-1193 provider (window.ethereum + EIP-6963 announce)
 * and the x402 fetch interceptor. EVM dApps pick us up automatically; HTTP-402
 * traffic on the page is auto-routed through Premon for policy review.
 */

import { installEip1193Provider } from "./provider";
import { installX402Interceptor } from "./x402-interceptor";

try {
  installEip1193Provider();
  console.info("[PREMON] EIP-1193 provider installed");
} catch (err) {
  console.error("[PREMON] wallet provider install failed:", err);
}

try {
  installX402Interceptor();
} catch (err) {
  console.error("[PREMON] x402 interceptor failed:", err);
}
