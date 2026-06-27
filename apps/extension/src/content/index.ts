/**
 * Content script — runs in the page's ISOLATED world at document_start.
 *
 * Two jobs:
 * 1. Inject the inpage script as a <script> so it executes in MAIN world
 *    (where it can install window.ethereum and announce via EIP-6963).
 * 2. Bridge messages between the inpage script (window.postMessage) and the
 *    background service worker (chrome.runtime.connect). Provider RPC goes
 *    over the `bx-provider` port; x402 review goes over `bx-x402`.
 */

import browser from "webextension-polyfill";
import { isEnvelope, PROTOCOL_TAG, type Envelope } from "@premon/ext-protocol";

const PAGE_TAG = "__bx_ws" as const;

interface PageReq { __bx_ws: 1; kind: "req"; id: string; method: string; payload: unknown }
interface PageRsp { __bx_ws: 1; kind: "rsp"; id: string; payload: unknown }
interface PageErr { __bx_ws: 1; kind: "err"; id: string; error: string }

function isPageReq(d: unknown): d is PageReq {
  if (!d || typeof d !== "object") return false;
  const r = d as Record<string, unknown>;
  return r[PAGE_TAG] === 1 && r.kind === "req" && typeof r.id === "string" && typeof r.method === "string";
}

/* ────────────── Inject inpage script ────────────── */

(function injectInpage() {
  try {
    const url = browser.runtime.getURL("inpage.js");
    const script = document.createElement("script");
    script.type = "module";
    script.src = url;
    script.dataset.bxInpage = "1";
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  } catch (err) {
    console.error("[PREMON] inpage injection failed:", err);
  }
})();

/* ────────────── Background ports + bridge ────────────── */

const providerPort = browser.runtime.connect({ name: "bx-provider" });
const x402Port = browser.runtime.connect({ name: "bx-x402" });
const pending = new Map<string, string>(); // backgroundReqId → pageReqId

function portFor(method: string): browser.Runtime.Port {
  return method === "x402.review" ? x402Port : providerPort;
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  if (!isPageReq(ev.data)) return;
  forwardToBackground(ev.data);
});

function forwardToBackground(req: PageReq): void {
  const bxId = newReqId();
  pending.set(bxId, req.id);
  const env: Envelope<string, unknown> = {
    __bx: PROTOCOL_TAG,
    id: bxId,
    kind: "req",
    method: req.method,
    payload: req.payload,
  };
  try {
    portFor(req.method).postMessage(env);
  } catch (err) {
    pending.delete(bxId);
    postPageErr(req.id, err instanceof Error ? err.message : String(err));
  }
}

function onPortMessage(raw: unknown): void {
  if (!isEnvelope(raw)) return;
  if (raw.kind !== "rsp") return;
  const pageId = pending.get(raw.id);
  if (!pageId) return;
  pending.delete(raw.id);

  const payload = raw.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    postPageErr(pageId, payload.error);
  } else {
    postPageRsp(pageId, raw.payload);
  }
}

providerPort.onMessage.addListener(onPortMessage);
x402Port.onMessage.addListener(onPortMessage);

function onDisconnect(): void {
  for (const pageId of pending.values()) {
    postPageErr(pageId, "PREMON background disconnected");
  }
  pending.clear();
}
providerPort.onDisconnect.addListener(onDisconnect);
x402Port.onDisconnect.addListener(onDisconnect);

function postPageRsp(id: string, payload: unknown) {
  const env: PageRsp = { __bx_ws: 1, kind: "rsp", id, payload };
  window.postMessage(env, window.location.origin);
}

function postPageErr(id: string, error: string) {
  const env: PageErr = { __bx_ws: 1, kind: "err", id, error };
  window.postMessage(env, window.location.origin);
}

function newReqId(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ((Math.random() * 65536) | 0).toString(16).padStart(4, "0");
  return s;
}
