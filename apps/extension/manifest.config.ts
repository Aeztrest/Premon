import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

/**
 * Single source of truth for the extension manifest (Monad / EVM build).
 *
 * Target switching: env.mode === "firefox" swaps fields where Firefox MV3
 * differs from Chrome MV3 (background.scripts vs service_worker, options_ui
 * vs options_page).
 */
export default defineManifest(({ mode }) => {
  const isFirefox = mode === "firefox";

  return {
    manifest_version: 3,
    name: "Premon",
    short_name: "Premon",
    version: pkg.version,
    description:
      "The hard hat for your Monad wallet — every transaction simulated, explained, and blocked when dangerous.",

    icons: {
      "16": "icons/16.png",
      "32": "icons/32.png",
      "48": "icons/48.png",
      "128": "icons/128.png",
    },

    action: {
      default_popup: "src/popup/index.html",
      default_icon: "icons/32.png",
    },

    ...(isFirefox
      ? { options_ui: { page: "src/options/index.html", open_in_tab: true } }
      : { options_page: "src/options/index.html" }),

    // Firefox 128+ supports `type: "module"` on background.scripts, matching
    // Chrome MV3 module service workers.
    ...(isFirefox
      ? { background: { scripts: ["src/background/index.ts"], type: "module" as const } }
      : { background: { service_worker: "src/background/index.ts", type: "module" as const } }),

    content_scripts: [
      {
        matches: ["<all_urls>"],
        js: ["src/content/index.ts"],
        run_at: "document_start",
        all_frames: false,
      },
    ],

    web_accessible_resources: [
      {
        // `inpage.js` is the stable entry the content script injects; the
        // wildcard covers every code-split chunk it imports.
        resources: ["inpage.js", "assets/*"],
        matches: ["<all_urls>"],
      },
    ],

    // `windows` is required for `browser.windows.create()` — opening the
    // Premon popup as a focused window when a dApp queues a sign or connect
    // request. MV3 disallows programmatic `chrome.action.openPopup()`.
    permissions: ["storage", "alarms", "notifications", "windows"],

    host_permissions: [
      // Monad RPC (testnet + mainnet).
      "https://testnet-rpc.monad.xyz/*",
      "https://rpc.monad.xyz/*",
      // Monad block explorers.
      "https://testnet.monadexplorer.com/*",
      "https://monadexplorer.com/*",
      // Premon analyze server (dev + production placeholder).
      "http://localhost:8080/*",
    ],

    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
    },

    ...(isFirefox
      ? {
          browser_specific_settings: {
            gecko: {
              id: "premon@premon.dev",
              strict_min_version: "128.0",
              data_collection_permissions: { required: [] as never[] },
            },
          },
        }
      : {}),
  };
});
