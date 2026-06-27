/**
 * Post-sign monitor (Monad build).
 *
 * Polls the provider for the user's native MON balance. When the balance drops
 * but Premon has no broadcast in its recent history to explain it, that's a
 * *drift alert* — value left the wallet that Premon never approved.
 *
 * MV3 caveat: the polling loop lives only as long as the service worker. On
 * wake, `start()` re-reads the last-seen balance from storage so a single
 * drop across a sleep window isn't mistaken for many.
 */

import browser from "webextension-polyfill";
import { getProvider } from "./connection";
import { appendAlert, countUnread } from "../db/alerts";
import { appendHistory, listHistory } from "../db/history";
import { dispatch, subscribe, getState } from "../state/store";

const LAST_SEEN_KEY = "premon.monitor.lastSeen.v1";
const POLL_INTERVAL_MS = 12_000;
/** A broadcast we made within this window explains a balance drop. */
const SELF_TX_WINDOW_MS = 5 * 60_000;

interface LastSeen {
  address?: string;
  wei?: string;
}

class Monitor {
  private address: string | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  async start(address: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.address = address;
    this.scheduleNext();
    console.info("[PREMON] post-sign monitor live for", `${address.slice(0, 10)}…`);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.address = null;
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(() => {
      void this.pollOnce().finally(() => this.scheduleNext());
    }, POLL_INTERVAL_MS);
  }

  private async pollOnce(): Promise<void> {
    if (!this.address) return;
    try {
      const provider = getProvider();
      const wei = (await provider.getBalance(this.address)).toString();
      const last = await readLastSeen();

      if (last.address === this.address && last.wei !== undefined) {
        const prev = BigInt(last.wei);
        const now = BigInt(wei);
        if (now < prev) {
          await this.onBalanceDrop(prev - now);
        }
      }
      await writeLastSeen({ address: this.address, wei });
    } catch (err) {
      console.warn("[PREMON] monitor poll failed:", err);
    }
  }

  private async onBalanceDrop(deltaWei: bigint): Promise<void> {
    // Did we broadcast anything recently? If so, the drop is expected.
    const recent = await listHistory({ limit: 25 });
    const cutoff = Date.now() - SELF_TX_WINDOW_MS;
    const explained = recent.some((h) => h.broadcast && h.createdAt >= cutoff);
    if (explained) return;

    await appendAlert({
      severity: "high",
      kind: "drift",
      merchantOrigin: "unknown",
      txHash: null,
      body: "Your MON balance dropped without a transaction Premon approved.",
      createdAt: Date.now(),
      dismissedAt: null,
    });
    await appendHistory({
      type: "alert",
      txHash: null,
      origin: null,
      summary: `Drift detected — ${deltaWei.toString()} wei left your wallet unexpectedly`,
      decision: "block",
      reasons: ["Premon didn't sign a transaction explaining this balance change. Investigate."],
      broadcast: false,
      createdAt: Date.now(),
    });

    const total = await countUnread();
    dispatch({ type: "alerts.set", count: total });

    try {
      browser.notifications.create(`bx-drift-${Date.now()}`, {
        type: "basic",
        iconUrl: browser.runtime.getURL("icons/128.png"),
        title: "Unexpected balance change",
        message: "Premon didn't approve this movement. Open the wallet to investigate.",
      });
    } catch (err) {
      console.warn("[PREMON] notification failed:", err);
    }
  }
}

async function readLastSeen(): Promise<LastSeen> {
  const all = await browser.storage.local.get(LAST_SEEN_KEY);
  return (all[LAST_SEEN_KEY] as LastSeen | undefined) ?? {};
}

async function writeLastSeen(v: LastSeen): Promise<void> {
  await browser.storage.local.set({ [LAST_SEEN_KEY]: v });
}

const monitor = new Monitor();

/**
 * Wire the monitor to the wallet state machine. Starts when phase becomes
 * "ready" with an address, stops when leaving that phase.
 */
export function startMonitorLifecycle(): void {
  subscribe((next, prev) => {
    const reachedReady = next.phase === "ready" && prev.phase !== "ready";
    const leftReady = prev.phase === "ready" && next.phase !== "ready";

    if (reachedReady && next.address) {
      void monitor.start(next.address);
    }
    if (leftReady) {
      void monitor.stop();
    }
  });

  const s = getState();
  if (s.phase === "ready" && s.address) {
    void monitor.start(s.address);
  }
}
