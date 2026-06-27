import type { AppConfig } from "../../config/index.js";
import type { MonadRpc } from "../../infra/monad-rpc.js";

export type RouteDeps = {
  config: AppConfig;
  createRpc: () => MonadRpc;
};
