/**
 * Wallet state machine (Monad build).
 *
 * Single source of truth. Every surface (popup, options, content script)
 * reads from here via the message router.
 */

import type { MonadNetwork, WalletStateSnapshot } from "@premon/ext-protocol";
import { chainFor } from "../../shared/chain";

export type WalletPhase =
  | "uninitialized"  // no keystore present
  | "locked"         // keystore present, session not unlocked
  | "ready"          // unlocked, idle
  | "signing"        // a sign request is in flight
  | "alert";         // drift / verify-orphan banner overlay

export interface WalletState {
  phase: WalletPhase;
  network: MonadNetwork;
  /** Connected EOA address (0x). */
  address: string | null;
  alertsUnread: number;
  watchedAddresses: string[];
  /** Idle timeout in ms (default 15 min). */
  idleTimeoutMs: number;
  /** Last activity timestamp; used to compute auto-lock. */
  lastActivityAt: number;
}

export const INITIAL_STATE: WalletState = {
  phase: "uninitialized",
  network: "testnet",
  address: null,
  alertsUnread: 0,
  watchedAddresses: [],
  idleTimeoutMs: 15 * 60 * 1000,
  lastActivityAt: Date.now(),
};

/* ────────────── Actions (the only way to mutate state) ────────────── */

export type Action =
  | { type: "wallet.created"; address: string }
  | { type: "wallet.unlocked"; address: string }
  | { type: "wallet.locked" }
  | { type: "wallet.reset" }
  | { type: "network.set"; network: MonadNetwork }
  | { type: "sign.start" }
  | { type: "sign.end" }
  | { type: "alerts.set"; count: number }
  | { type: "alerts.increment" }
  | { type: "watch.add"; address: string }
  | { type: "watch.remove"; address: string }
  | { type: "activity.touch" };

export function reduce(state: WalletState, action: Action): WalletState {
  switch (action.type) {
    case "wallet.created":
    case "wallet.unlocked":
      return {
        ...state,
        phase: "ready",
        address: action.address,
        lastActivityAt: Date.now(),
      };

    case "wallet.locked":
      return { ...state, phase: "locked" };

    case "wallet.reset":
      return { ...INITIAL_STATE, network: state.network };

    case "network.set":
      return { ...state, network: action.network };

    case "sign.start":
      return { ...state, phase: "signing", lastActivityAt: Date.now() };

    case "sign.end":
      return { ...state, phase: "ready" };

    case "alerts.set":
      return { ...state, alertsUnread: Math.max(0, action.count) };

    case "alerts.increment":
      return { ...state, alertsUnread: state.alertsUnread + 1 };

    case "watch.add":
      return state.watchedAddresses.includes(action.address)
        ? state
        : { ...state, watchedAddresses: [...state.watchedAddresses, action.address] };

    case "watch.remove":
      return { ...state, watchedAddresses: state.watchedAddresses.filter((p) => p !== action.address) };

    case "activity.touch":
      return { ...state, lastActivityAt: Date.now() };
  }
}

/* ────────────── Snapshot (the shape exported to surfaces) ────────────── */

export function snapshot(s: WalletState): WalletStateSnapshot {
  return {
    phase: s.phase,
    network: s.network,
    chainId: chainFor(s.network).chainId,
    address: s.address,
    alertsUnread: s.alertsUnread,
    watchedAddresses: s.watchedAddresses,
  };
}
