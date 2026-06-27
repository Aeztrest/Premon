/**
 * x402 review handler (Monad / EVM build) — runs when the inpage interceptor
 * catches a 402 response and asks Premon whether to pay.
 *
 * Pipeline:
 *   1. Validate PaymentRequirements (network, asset 0x, payTo, amount).
 *   2. Network matches the wallet's active network.
 *   3. Asset allowlist + facilitator allowlist + merchant origins.
 *   4. Look up / auto-create allowance for (origin, asset).
 *   5. Apply caps (per-tx, hourly, daily).
 *   6. Build a real on-chain USDC `transfer` transaction.
 *   7. Auto-broadcast in the background (default) or route through the standard
 *      eth_sendTransaction approval popup, which broadcasts on approve.
 *   8. Return the base64 `X-PAYMENT` header carrying the on-chain tx hash.
 *   9. Increment the allowance ledger.
 */

import browser from "webextension-polyfill";
import { BALANCED_POLICY, type GuardPolicy } from "@premon/guard";

import { useWallet, isUnlocked } from "../crypto/session";
import { getSnapshot, dispatch } from "../state/store";
import { getProvider } from "../rpc/connection";
import { chainFor } from "../../shared/chain";
import {
  enqueue,
  newRequestId,
  type SignSuccess,
} from "../provider/sign-queue";
import {
  makeAllowanceId,
  readAllowance,
  recordHit,
  writeAllowance,
  type AllowanceRow,
} from "../db/allowances";
import {
  atomicToUi,
  validateRequirements,
  type PaymentRequirements,
} from "./parse";
import { buildX402TransferTx, encodeX402Header } from "./build";
import { appendHistory } from "../db/history";

const POLICY_STORAGE_KEY = "premon.policy.v1";

interface ReviewRequest {
  origin: string;
  requestUrl: string;
  requirements: PaymentRequirements;
}

interface ApprovedDecision {
  action: "approve";
  headerValue: string;
}
interface DeclinedDecision {
  action: "decline";
  reason: string;
}
type Decision = ApprovedDecision | DeclinedDecision;

export async function x402Review(rawReq: unknown): Promise<Decision> {
  const { origin, requirements } = rawReq as ReviewRequest;

  if (!isUnlocked())
    return { action: "decline", reason: "Premon wallet is locked." };

  // 1. Spec validation.
  const v = validateRequirements(requirements);
  if (!v.ok)
    return { action: "decline", reason: `Invalid PaymentRequirements: ${v.reason}` };
  const network = v.network!;

  // 2. Network match.
  const snap = getSnapshot();
  if (snap.network !== network) {
    return {
      action: "decline",
      reason: `dApp asks for ${network}; wallet on ${snap.network}.`,
    };
  }
  if (!snap.address) {
    return { action: "decline", reason: "Wallet not initialized." };
  }
  const chain = chainFor(network);

  // 3. Policy + allowlists.
  const policy = await loadPolicy();
  if (
    policy.allowedAssets &&
    policy.allowedAssets.length > 0 &&
    !policy.allowedAssets.includes(requirements.asset)
  ) {
    return {
      action: "decline",
      reason: `Asset ${requirements.asset} not on your trusted-assets list.`,
    };
  }
  if (policy.blockedMerchantOrigins?.includes(origin)) {
    return { action: "decline", reason: `${origin} is on your blocked-merchants list.` };
  }
  if (
    policy.allowedMerchantOrigins &&
    policy.allowedMerchantOrigins.length > 0 &&
    !policy.allowedMerchantOrigins.includes(origin)
  ) {
    return { action: "decline", reason: `${origin} not on your allowed-merchants list.` };
  }
  const facilitator =
    requirements.extra.facilitator ?? requirements.extra.feePayer ?? "";
  if (
    policy.allowedFacilitators &&
    policy.allowedFacilitators.length > 0 &&
    facilitator &&
    !policy.allowedFacilitators.includes(facilitator)
  ) {
    return { action: "decline", reason: `Facilitator ${facilitator} not trusted.` };
  }

  // 4. Allowance lookup / auto-create.
  const allowanceId = makeAllowanceId(origin, requirements.asset);
  let allowance = await readAllowance(allowanceId);
  if (!allowance) {
    allowance = await createDefaultAllowance(
      origin,
      requirements.asset,
      requirements.payTo,
      policy,
    );
  }
  if (allowance.status === "revoked") {
    return { action: "decline", reason: `${origin} has been revoked from your wallet.` };
  }
  if (allowance.status === "paused") {
    return {
      action: "decline",
      reason: `${origin} is paused. Resume from Allowances to continue.`,
    };
  }

  // 5. Caps.
  const amountUi = atomicToUi(requirements.amount, chain.usdcDecimals);
  if (policy.maxX402PerTx !== undefined && amountUi > policy.maxX402PerTx) {
    return {
      action: "decline",
      reason: `Payment ${amountUi.toFixed(6)} exceeds your per-tx cap of ${policy.maxX402PerTx}.`,
    };
  }

  const HOUR = 60 * 60_000;
  const DAY = 24 * HOUR;
  const now = Date.now();
  const projHour =
    (now - allowance.spentHourTs > HOUR ? 0 : allowance.spentHour) + amountUi;
  const projDay =
    (now - allowance.spentDayTs > DAY ? 0 : allowance.spentDay) + amountUi;

  if (allowance.capPerHour > 0 && projHour > allowance.capPerHour) {
    return {
      action: "decline",
      reason: `${origin}: would exceed ${allowance.capPerHour} hourly cap (${projHour.toFixed(6)}).`,
    };
  }
  if (allowance.capPerDay > 0 && projDay > allowance.capPerDay) {
    return {
      action: "decline",
      reason: `${origin}: would exceed ${allowance.capPerDay} daily cap (${projDay.toFixed(6)}).`,
    };
  }

  // 6. Build the on-chain USDC transfer. We BROADCAST a real ERC-20 transfer
  //    (not an off-chain EIP-3009 authorization) so the USDC actually moves and
  //    the wallet balance visibly decreases.
  const payTo = requirements.payTo;
  const amountUiStr = amountUi.toFixed(6);
  let txHash: string;

  // 7. Caps already enforced the firewall, so by default we AUTO-APPROVE and
  //    broadcast in the background. Set `x402AutoApprove: false` (Strict) to
  //    confirm each payment via the standard approval popup before broadcast.
  if (policy.x402AutoApprove !== false) {
    try {
      const signer = useWallet().connect(getProvider());
      const resp = await signer.sendTransaction(buildX402TransferTx(requirements));
      txHash = resp.hash;
    } catch (err) {
      return {
        action: "decline",
        reason: `Auto-approval failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    await appendHistory({
      type: "x402",
      txHash,
      origin,
      summary: `Auto-paid x402 · ${amountUiStr} USDC → ${payTo.slice(0, 6)}…${payTo.slice(-4)}`,
      decision: "allow",
      reasons: ["Within caps — auto-approved"],
      broadcast: true,
      createdAt: Date.now(),
    });
  } else {
    // Manual: route through the SAME approval + broadcast mechanism that the
    // provider's eth_sendTransaction uses. The popup shows Premon analysis of
    // the USDC transfer; on approve it broadcasts and returns the tx hash.
    const label = `x402 payment · ${amountUiStr} USDC → ${payTo.slice(0, 6)}…${payTo.slice(-4)}`;
    let result: SignSuccess;
    try {
      result = await enqueueAndWait(origin, requirements, label);
    } catch (err) {
      return {
        action: "decline",
        reason:
          err instanceof Error ? err.message : "You declined the x402 payment.",
      };
    }
    if (result.kind !== "transactionAndSend" || !result.txHash) {
      return { action: "decline", reason: "You declined the x402 payment." };
    }
    txHash = result.txHash;
    await appendHistory({
      type: "x402",
      txHash,
      origin,
      summary: `Paid x402 · ${amountUiStr} USDC → ${payTo.slice(0, 6)}…${payTo.slice(-4)}`,
      decision: "allow",
      reasons: ["Approved at popup"],
      broadcast: true,
      createdAt: Date.now(),
    });
  }

  const headerValue = encodeX402Header({
    network,
    txHash,
    from: snap.address,
    requirements,
  });

  // 8 + 9. Record the hit (optimistic — drift catches non-settlement).
  await recordHit(allowanceId, amountUi);

  return { action: "approve", headerValue };
}

/* ────────────── Helpers ────────────── */

function enqueueAndWait(
  origin: string,
  requirements: PaymentRequirements,
  label: string,
): Promise<SignSuccess> {
  // Reuse the eth_sendTransaction infra: a "transactionAndSend" sign request
  // shows the standard approval popup (with Premon analysis), then broadcasts
  // and resolves with the on-chain tx hash.
  const tx = buildX402TransferTx(requirements);
  return new Promise<SignSuccess>((resolve, reject) => {
    const requestId = newRequestId();
    enqueue({
      requestId,
      kind: "transactionAndSend",
      origin,
      payload: JSON.stringify(tx),
      label,
      resolve,
      reject,
    });
    dispatch({ type: "sign.start" });
  });
}

export async function loadPolicy(): Promise<GuardPolicy> {
  const all = await browser.storage.local.get(POLICY_STORAGE_KEY);
  return (all[POLICY_STORAGE_KEY] as GuardPolicy | undefined) ?? BALANCED_POLICY;
}

export async function createDefaultAllowance(
  origin: string,
  asset: string,
  spender: string,
  policy: GuardPolicy,
): Promise<AllowanceRow> {
  const now = Date.now();
  const row: AllowanceRow = {
    id: makeAllowanceId(origin, asset),
    merchantOrigin: origin,
    asset,
    capPerTx: policy.maxX402PerTx ?? 1.0,
    capPerHour: policy.x402HourlyCap ?? 5.0,
    capPerDay: policy.x402DailyCap ?? 25.0,
    spentTx: 0,
    spentHour: 0,
    spentHourTs: now,
    spentDay: 0,
    spentDayTs: now,
    hits: 0,
    lastHitAt: null,
    expiresAt: null,
    status: "active",
    spender,
    createdAt: now,
    updatedAt: now,
  };
  await writeAllowance(row);
  return row;
}
