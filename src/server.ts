import { createApp } from "./app.js";
import { config } from "./config.js";
import { close, connect } from "./db.js";

async function main(): Promise<void> {
  const app = createApp();

  console.log(
    `[config] backend=${config.backend} endpoint=${config.uri} tls=${config.mongoOptions.tls === true} database="${config.dbName}"`,
  );

  // Explicit connect, like `await client.connect()` in the quick start. The API
  // still starts if the backend is down: the driver reconnects lazily on the
  // first request and GET /health reports the outage.
  try {
    await connect();
    console.log(`[db] connected to ${config.backend} at ${config.uri}`);
  } catch (error) {
    console.warn(
      `[db] ${config.backend} not reachable yet: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.warn("[db] the API will still start; GET /health reports the outage.");
  }

  if (!config.credentialsConfigured) {
    console.warn("[config] credentials missing: set DOCUMENTDB_USERNAME / DOCUMENTDB_PASSWORD (or USERNAME / PASSWORD).");
  }
  if (config.adminToken) {
    console.log("[admin] /admin/* is protected by ADMIN_TOKEN.");
  } else {
    console.warn("[admin] ADMIN_TOKEN is not set: /admin/* is open (local development only).");
  }

  const server = app.listen(config.port, () => {
    console.log(`[http] listening on http://localhost:${config.port} - try GET /`);
  });

  function shutdown(signal: string): void {
    console.log(`\n[http] ${signal} received, shutting down`);
    server.close(() => {
      void close().finally(() => process.exit(0));
    });
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
