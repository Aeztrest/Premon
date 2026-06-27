/**
 * Programmatic popup launcher.
 *
 * Chrome MV3 disallows `chrome.action.openPopup()` from background contexts
 * without a user gesture — so when a dApp queues a sign / connect request we
 * open the popup HTML in a small focused window instead.
 *
 * One window at a time: if a popup is already open we just focus it.
 */

import browser from "webextension-polyfill";

const POPUP_URL_PATH = "src/popup/index.html";
const POPUP_WIDTH = 400;
const POPUP_HEIGHT = 640;

let currentPopupWindowId: number | null = null;

export async function openPopupWindow(): Promise<void> {
  if (currentPopupWindowId !== null) {
    try {
      const existing = await browser.windows.get(currentPopupWindowId);
      if (existing) {
        await browser.windows.update(currentPopupWindowId, { focused: true });
        return;
      }
    } catch {
      currentPopupWindowId = null;
    }
  }

  try {
    const url = browser.runtime.getURL(POPUP_URL_PATH) + "?window=1";
    const created = await browser.windows.create({
      url,
      type: "popup",
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      focused: true,
    });
    currentPopupWindowId = created.id ?? null;
  } catch (err) {
    console.warn("[PREMON] failed to open popup window:", err);
  }
}

export async function closePopupWindow(): Promise<void> {
  if (currentPopupWindowId === null) return;
  const id = currentPopupWindowId;
  currentPopupWindowId = null;
  try {
    await browser.windows.remove(id);
  } catch {
    /* already closed */
  }
}

export function resetPopupWindow(): void {
  currentPopupWindowId = null;
}
