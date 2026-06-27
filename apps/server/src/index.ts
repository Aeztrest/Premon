import { loadConfig } from "./config/index.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  app.log.info(
    {
      network: config.monad.network,
      chainId: config.monad.chainId,
      rpcUrl: config.monad.rpcUrl,
      authMode: config.authMode,
      x402: config.x402.enabled,
    },
    "Premon (Monad) starting",
  );

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
