import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run test files sequentially to avoid Postgres deadlocks
    fileParallelism: false,
    // Run tests within a file sequentially
    sequence: {
      concurrent: false,
    },
    testTimeout: 30000,
  },
});
