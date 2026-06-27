import { z } from "zod";
import { networkSchema } from "../config/index.js";

export const policySchema = z
  .object({
    maxLossPercent: z.number().min(0).max(100).optional(),
    /** Minimum post-tx balance of `minPostAsset` (decimal UI string of token units). */
    minPostUsdcBalance: z.number().nonnegative().optional(),
    /** Token the min balance applies to (0x address); defaults to USDC. */
    minPostAsset: z.string().optional(),
    /** Block any ERC-20 `approve` the tx grants. */
    blockApprovals: z.boolean().optional(),
    /** Block specifically unlimited (uint256-max) ERC-20 approvals. */
    blockUnlimitedApprovals: z.boolean().optional(),
    /** Block ERC-721 / ERC-1155 `setApprovalForAll` (operator drain primitive). */
    blockApprovalForAll: z.boolean().optional(),
    /** Block contracts on the configured risky-contract list. */
    blockRiskyContracts: z.boolean().optional(),
    /** With KNOWN_SAFE_CONTRACT_IDS set, block anything else. */
    blockUnknownContractExposure: z.boolean().optional(),
    /** Block txs whose trace contains a SELFDESTRUCT. */
    blockSelfdestruct: z.boolean().optional(),
    /** Block txs whose trace contains a DELEGATECALL to an untrusted target. */
    blockDelegatecall: z.boolean().optional(),
    /** Block ownership-transfer calls (`transferOwnership`, `Ownable`-style). */
    blockOwnershipTransfer: z.boolean().optional(),
    /** Tolerate `medium` findings without flipping safe=false. */
    allowWarnings: z.boolean().optional(),
    /** Require successful `eth_call` execution for `safe = true`. */
    requireSuccessfulSimulation: z.boolean().optional(),
    // x402 server-side rules
    requireMemo: z.boolean().optional(),
    /** Max total gas fee (gasLimit × gasPrice) in wei. */
    maxGasFeeWei: z.number().nonnegative().optional(),
    /** Max effective gas price (maxFeePerGas / gasPrice) in wei. */
    maxGasPriceWei: z.number().nonnegative().optional(),
    /** Allowlist of token identifiers (0x addresses / `native`). */
    allowedAssets: z.array(z.string()).optional(),
  })
  .passthrough(); // Tolerate client-only rules the server doesn't enforce.

export type Policy = z.infer<typeof policySchema>;

export const paymentRequirementsSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  asset: z.string(),
  amount: z.string(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number(),
  extra: z
    .object({
      /** EVM x402: address that sponsors gas on behalf of the user (EIP-3009 / paymaster). */
      sponsorBy: z.string().optional(),
      feePayer: z.string().optional(),
      memo: z.string().optional(),
    })
    .passthrough(),
});

export type PaymentRequirements = z.infer<typeof paymentRequirementsSchema>;

/**
 * An unsigned/partial EVM transaction request object. Either this or a raw
 * serialized hex string may be passed as `transaction`.
 */
export const txRequestObjectSchema = z
  .object({
    from: z.string().optional(),
    to: z.string().nullish(),
    /** Wei value as a decimal or 0x-hex string. */
    value: z.string().optional(),
    /** Calldata as a 0x-hex string. */
    data: z.string().optional(),
    /** Alias for data accepted for compatibility. */
    input: z.string().optional(),
    gas: z.string().optional(),
    gasLimit: z.string().optional(),
    gasPrice: z.string().optional(),
    maxFeePerGas: z.string().optional(),
    maxPriorityFeePerGas: z.string().optional(),
    nonce: z.union([z.string(), z.number()]).optional(),
    chainId: z.union([z.string(), z.number()]).optional(),
    type: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export type TxRequestObject = z.infer<typeof txRequestObjectSchema>;

export const analyzeRequestBodySchema = z.object({
  network: networkSchema,
  /**
   * The candidate transaction: either a raw serialized hex string (signed or
   * unsigned, `0x…`) or an unsigned tx request object. This replaces Stellar's
   * base64 `transactionXdr`.
   */
  transaction: z.union([z.string().min(1), txRequestObjectSchema]),
  policy: policySchema.default({}),
  /** Optional context: wallet whose assets we attribute changes to (0x…). */
  userWallet: z.string().optional(),
  integratorRequestId: z.string().max(256).optional(),
  /** When the candidate tx is an x402 payment, the merchant's requirements. */
  paymentRequirements: paymentRequirementsSchema.optional(),
});

export type AnalyzeRequestBody = z.infer<typeof analyzeRequestBodySchema>;
