import express from "express";
import { createRouter } from "./api";
import { startListener } from "./listener";
import {
  initDlqPersistence,
  loadOpenDlqEntries,
  closeDlqPersistence,
} from "./dlq";

const PORT = Number(process.env.PORT ?? 3001);
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5_000);

if (!CONTRACT_ID) {
  console.error("CONTRACT_ID environment variable is required");
  process.exit(1);
}

async function main(): Promise<void> {
  // Initialize DLQ persistence: run/verify the schema migration and load
  // open (non-replayed) entries so the admin replay API works after restart.
  await initDlqPersistence();
  const openEntries = await loadOpenDlqEntries();
  console.log(`[dlq] Loaded ${openEntries.length} open DLQ entries from persistence`);

  const app = express();
  app.use(createRouter(RPC_URL, CONTRACT_ID));

  const server = app.listen(PORT, () => {
    console.log(`[api] Webhook service listening on port ${PORT}`);
    startListener(RPC_URL, CONTRACT_ID, POLL_INTERVAL_MS);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[api] Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
      try {
        await closeDlqPersistence();
        console.log("[dlq] Persistence pool closed");
      } catch (err) {
        console.error("[dlq] Error closing persistence pool:", err);
      } finally {
        process.exit(0);
      }
    });
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[api] Fatal startup error:", err);
  process.exit(1);
});