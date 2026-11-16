import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/globalSetup.js"],
    setupFiles: ["./tests/setupEnv.js"],
    // All test files share one in-memory MongoDB, so run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000
  }
});
