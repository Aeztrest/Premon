import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  // Served at "/" in dev; the showcase deploy builds it under "/wallet/" via
  // WALLET_BASE so the popup-connect flow works on the same domain.
  base: process.env.WALLET_BASE || "/",
  plugins: [
    react(),
    nodePolyfills({ include: ["buffer", "crypto"] }),
  ],
  server: {
    port: 5180,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
