import type { GuardPolicy } from "@premon/guard";
import { BALANCED_POLICY } from "@premon/guard";

const KEY = "premon.policy.v1";

export function readPolicy(): GuardPolicy {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return BALANCED_POLICY;
    return JSON.parse(raw) as GuardPolicy;
  } catch {
    return BALANCED_POLICY;
  }
}

export function writePolicy(p: GuardPolicy): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function clearPolicy(): void {
  localStorage.removeItem(KEY);
}
