/**
 * Starts a local embedded PostgreSQL server for development.
 * Data is stored in ./data/db and persists between runs.
 *
 * Usage: npm run db:start   (keep this terminal open)
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const port = Number(process.env.EMBEDDED_PG_PORT ?? 5433);
const databaseDir = path.resolve(process.cwd(), "data", "db");
const stderr: string[] = [];
const firstRun = !fs.existsSync(path.join(databaseDir, "PG_VERSION"));

function portInUse(p: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: p });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

async function main() {
  if (await portInUse(port)) {
    console.log(`PostgreSQL is already running on 127.0.0.1:${port} - nothing to do.`);
    console.log("(To restart it, stop the other 'npm run db:start' terminal or kill postgres.exe first.)");
    return;
  }

  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: (msg) => stderr.push(String(msg)),
  });

  if (firstRun) {
    console.log("Initialising embedded PostgreSQL cluster (first run)...");
    await pg.initialise();
  }
  await pg.start();

  for (const db of ["salon_inventory", "salon_inventory_test"]) {
    try {
      await pg.createDatabase(db);
      console.log(`Created database ${db}`);
    } catch {
      /* already exists */
    }
  }

  console.log(`PostgreSQL ready on 127.0.0.1:${port} (user: postgres / password: postgres)`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = async () => {
    console.log("\nStopping PostgreSQL...");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start embedded PostgreSQL.");
  if (err) console.error(err);
  if (stderr.length) console.error(stderr.join(""));
  else console.error("Postgres exited early. Is another instance running, or is ./data/db locked?");
  process.exit(1);
});
