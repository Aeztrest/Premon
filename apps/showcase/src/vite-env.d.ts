/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Premon analyze server. Default http://localhost:8080 */
  readonly VITE_ANALYZE_URL?: string;
  /** API key for the analyze server. Default dev-key-change-me */
  readonly VITE_ANALYZE_API_KEY?: string;
  /** Origin of the Premon wallet popup. Default http://localhost:5180 */
  readonly VITE_WALLET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
