import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 600_000, // 10 minutes — these tests run real AI backends
    hookTimeout: 120_000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // Run sequentially to avoid resource contention
      },
    },
  },
});
