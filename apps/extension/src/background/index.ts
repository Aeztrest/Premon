/**
 * Background service worker entry (Monad build).
 *
 * Lifecycle: this file runs every time Chrome wakes the worker. Heavy
 * subsystems (RPC, IndexedDB) are opened on-demand by their callers, not here,
 * so the cold-start path stays fast.
 */

import browser from "webextension-polyfill";
import { startRouter } from "./messaging/router";
import { rehydrate, subscribe } from "./state/store";
import { INITIAL_STATE } from "./state/machine";
import { hasKeystore, readKeystore } from "./db/keystore";
import { startMonitorLifecycle } from "./rpc/monitor";
import { countUnread } from "./db/alerts";
import { openPopupWindow } from "./popup-window";

async function bootstrap(): Promise<void> {
  const exists = await hasKeystore();
  if (!exists) {
    rehydrate({ ...INITIAL_STATE, phase: "uninitialized" });
    return;
  }

  const row = await readKeystore();
  if (!row) {
    rehydrate({ ...INITIAL_STATE, phase: "uninitialized" });
    return;
  }

  let alertsUnread = 0;
  try {
    alertsUnread = await countUnread();
  } catch {
    /* IndexedDB might not be open yet */
  }

  rehydrate({
    ...INITIAL_STATE,
    phase: "locked",
    address: row.address,
    alertsUnread,
  });
}

browser.runtime.onInstalled.addListener(({ reason }) => {
  console.info(`[PREMON] installed (${reason})`);
});

void bootstrap().catch((err) => {
  console.error("[PREMON] bootstrap failed:", err);
});

startRouter();
startMonitorLifecycle();

// Auto-open the popup window whenever a dApp queues a sign or connect request.
subscribe((next, prev) => {
  if (next.phase === "signing" && prev.phase !== "signing") {
    void openPopupWindow();
  }
});
