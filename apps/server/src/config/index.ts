import { isAddress, getAddress } from "ethers";
import { z } from "zod";

const networkSchema = z.enum(["testnet", "mainnet"]);

const authModeSchema = z.enum(["api_key", "x402", "both"]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  DELTAG_API_KEYS: z.string().optional(),
  DELTAG_AUTH_MODE: authModeSchema.optional(),

  MONAD_NETWORK: networkSchema.default("testnet"),
  /** JSON-RPC endpoint (Monad). Required. */
  MONAD_RPC_URL: z.string().url(),
  /** Optional chainId override; defaults to the network's canonical id. */
  MONAD_CHAIN_ID: z.coerce.number().int().positive().optional(),
  /** USDC token contract on the active network (0x…). */
  MONAD_USDC_ADDRESS: z.string().optional(),
  /** USDC decimals (Monad testnet USDC is 6). */
  MONAD_USDC_DECIMALS: z.coerce.number().int().nonnegative().default(6),

  RISKY_CONTRACT_IDS: z.string().optional(),
  KNOWN_SAFE_CONTRACT_IDS: z.string().optional(),

  MAX_SIMULATION_OPERATIONS: z.coerce.number().int().positive().max(100).default(20),
  MAX_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  DELTAG_RATE_LIMIT_MAX: z.coerce.number().int().nonnegative().default(200),
  DELTAG_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  DELTAG_TRUST_PROXY: z.string().optional(),
  /** CORS allow-origin for browser frontends on other origins. Default "*". */
  CORS_ALLOW_ORIGIN: z.string().optional(),

  X402_ENABLED: z.string().optional(),
  X402_FACILITATOR_URL: z.string().url().optional(),
  X402_PAY_TO: z.string().optional(),
  X402_NETWORK: z.string().optional(),
  X402_ANALYZE_PRICE: z.string().optional(),
});

export type MonadNetwork = z.infer<typeof networkSchema>;
export type AuthMode = z.infer<typeof authModeSchema>;

export type X402Config = {
  enabled: boolean;
  facilitatorUrl: string;
  payTo: string;
  network: string;
  analyzePrice: string;
};

export type MonadNetworkConfig = {
  network: MonadNetwork;
  rpcUrl: string;
  chainId: number;
  /** Block explorer base URL (for UI deep-links). */
  explorerUrl: string;
  /** Native token symbol. */
  nativeSymbol: string;
  /** Native token decimals (always 18 on EVM). */
  nativeDecimals: number;
  /** Canonical USDC token contract (0x…). */
  usdcAddress: string;
  usdcDecimals: number;
};

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  logLevel: z.infer<typeof envSchema>["LOG_LEVEL"];
  apiKeys: string[];
  authMode: AuthMode;
  x402: X402Config;
  monad: MonadNetworkConfig;
  riskyContractIds: Set<string>;
  knownSafeContractIds: Set<string>;
  maxSimulationOperations: number;
  maxBodyBytes: number;
  requestTimeoutMs: number;
  /** 0 = rate limiting disabled */
  rateLimitMax: number;
  rateLimitWindowMs: number;
  trustProxy: boolean;
  /** CORS allow-origin header value ("*" or a specific origin). */
  corsAllowOrigin: string;
};

// Monad chain ids + explorer endpoints.
const CHAIN_ID_TESTNET = 10143;
const CHAIN_ID_MAINNET = 143;
const EXPLORER_TESTNET = "https://testnet.monadexplorer.com";
const EXPLORER_MAINNET = "https://monadexplorer.com";

// USDC contract defaults. The testnet value is overridable via env because
// testnet token deployments rotate; set MONAD_USDC_ADDRESS to be authoritative.
const USDC_TESTNET = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const USDC_MAINNET = "0x0000000000000000000000000000000000000000";

function chainIdFor(network: MonadNetwork): number {
  return network === "mainnet" ? CHAIN_ID_MAINNET : CHAIN_ID_TESTNET;
}

function explorerFor(network: MonadNetwork): string {
  return network === "mainnet" ? EXPLORER_MAINNET : EXPLORER_TESTNET;
}

function defaultUsdcFor(network: MonadNetwork): string {
  return network === "mainnet" ? USDC_MAINNET : USDC_TESTNET;
}

function splitIds(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => normalizeAddressLoose(s)),
  );
}

/** Lower-cases + checksums when it is a valid address; otherwise returns as-is. */
function normalizeAddressLoose(s: string): string {
  return isAddress(s) ? getAddress(s) : s;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment configuration: ${JSON.stringify(msg)}`);
  }
  const e = parsed.data;
  const apiKeys =
    e.DELTAG_API_KEYS?.split(",")
      .map((k) => k.trim())
      .filter(Boolean) ?? [];

  const x402Raw = (e.X402_ENABLED ?? "").trim().toLowerCase();
  const x402Enabled = x402Raw === "1" || x402Raw === "true" || x402Raw === "yes";
  const payTo = e.X402_PAY_TO?.trim() ?? "";
  if (x402Enabled) {
    if (!payTo) throw new Error("X402_PAY_TO is required when X402_ENABLED=true");
    if (!isAddress(payTo)) {
      throw new Error(`X402_PAY_TO is not a valid EVM address: ${payTo}`);
    }
  }

  let authMode: AuthMode = e.DELTAG_AUTH_MODE ?? "api_key";
  if (x402Enabled && !e.DELTAG_AUTH_MODE) {
    authMode = apiKeys.length > 0 ? "both" : "x402";
  }
  if (!x402Enabled && authMode !== "api_key") {
    authMode = "api_key";
  }

  const trustProxyRaw = (e.DELTAG_TRUST_PROXY ?? "").trim().toLowerCase();
  const trustProxy =
    trustProxyRaw === "1" || trustProxyRaw === "true" || trustProxyRaw === "yes";

  const network = e.MONAD_NETWORK;
  const usdcRaw = e.MONAD_USDC_ADDRESS?.trim() || defaultUsdcFor(network);
  if (!isAddress(usdcRaw)) {
    throw new Error(`MONAD_USDC_ADDRESS is not a valid EVM address: ${usdcRaw}`);
  }

  const monad: MonadNetworkConfig = {
    network,
    rpcUrl: e.MONAD_RPC_URL,
    chainId: e.MONAD_CHAIN_ID ?? chainIdFor(network),
    explorerUrl: explorerFor(network),
    nativeSymbol: "MON",
    nativeDecimals: 18,
    usdcAddress: getAddress(usdcRaw),
    usdcDecimals: e.MONAD_USDC_DECIMALS,
  };

  const x402: X402Config = {
    enabled: x402Enabled,
    facilitatorUrl: e.X402_FACILITATOR_URL ?? "https://www.x402.org/facilitator",
    payTo: payTo ? getAddress(payTo) : "",
    network: e.X402_NETWORK?.trim() || `eip155:${monad.chainId}`,
    analyzePrice: e.X402_ANALYZE_PRICE?.trim() || "$0.001",
  };

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    apiKeys,
    authMode,
    x402,
    monad,
    riskyContractIds: splitIds(e.RISKY_CONTRACT_IDS),
    knownSafeContractIds: splitIds(e.KNOWN_SAFE_CONTRACT_IDS),
    maxSimulationOperations: e.MAX_SIMULATION_OPERATIONS,
    maxBodyBytes: e.MAX_BODY_BYTES,
    requestTimeoutMs: e.REQUEST_TIMEOUT_MS,
    rateLimitMax: e.DELTAG_RATE_LIMIT_MAX,
    rateLimitWindowMs: e.DELTAG_RATE_LIMIT_WINDOW_MS,
    trustProxy,
    corsAllowOrigin: e.CORS_ALLOW_ORIGIN?.trim() || "*",
  };
}

export { networkSchema };
