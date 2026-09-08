import { defineConfig } from "vitest/config";
import path from "node:path";

/** Config for HTTP tests that run against a live server (no test database, no global setup). */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", include: ["tests/http/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
});
