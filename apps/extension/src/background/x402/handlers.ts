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
 *   6. Build the EIP-3009 authorization payment.
 *   7. Auto-approve in the background (default) or enqueue for popup review.
 *   8. Return the base64 `X-PAYMENT` header value.
 *   9. Increment the allowance ledger.
 */

import browser from "webextension-polyfill";
import { BALANCED_POLICY, type GuardPolicy } from "@premon/guard";

import { useWallet, isUnlocked } from "../crypto/session";
import { getSnapshot, dispatch } from "../state/store";
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
import { buildX402Payment, signX402Payment } from "./build";
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
  const { origin, requestUrl, requirements } = rawReq as ReviewRequest;

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

  // 6. Build the payment authorization.
  const built = buildX402Payment(snap.address, requirements, chain);

  // 7. Sign. Caps already enforced the firewall, so by default we AUTO-APPROVE
  // in the background. Set `x402AutoApprove: false` (Strict) to confirm each.
  const payTo = requirements.payTo;
  let headerValue: string;
  if (policy.x402AutoApprove !== false) {
    try {
      const signer = useWallet();
      headerValue = await signX402Payment(signer, built);
    } catch (err) {
      return {
        action: "decline",
        reason: `Auto-approval failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    await appendHistory({
      type: "x402",
      txHash: null,
      origin,
      summary: `Auto-paid x402 · ${amountUi.toFixed(6)} → ${payTo.slice(0, 6)}…${payTo.slice(-4)}`,
      decision: "allow",
      reasons: ["Within policy caps — auto-approved"],
      broadcast: false,
      createdAt: Date.now(),
    });
  } else {
    const label = `x402 payment · ${amountUi.toFixed(6)} → ${payTo.slice(0, 6)}…${payTo.slice(-4)}`;
    const result = await enqueueAndWait(origin, built, requestUrl, label);
    if (result.kind !== "x402Payment" || !result.headerValue) {
      return { action: "decline", reason: "Sign request did not return a signed payment." };
    }
    headerValue = result.headerValue;
  }

  // 8 + 9. Record the hit (optimistic — drift catches non-settlement).
  await recordHit(allowanceId, amountUi);

  return { action: "approve", headerValue };
}

/* ────────────── Helpers ────────────── */

function enqueueAndWait(
  origin: string,
  built: ReturnType<typeof buildX402Payment>,
  requestUrl: string,
  label: string,
): Promise<SignSuccess> {
  return new Promise<SignSuccess>((resolve, reject) => {
    const requestId = newRequestId();
    enqueue({
      requestId,
      kind: "x402Payment",
      origin,
      payload: JSON.stringify({ built, requestUrl }),
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
