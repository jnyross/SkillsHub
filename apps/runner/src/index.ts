import { executeRun } from "./execute-run.js";
import type { RunConfig } from "./execute-run.js";

/**
 * Runner service entry point.
 *
 * In production, this would listen for run requests from the worker
 * (via a queue, HTTP endpoint, or similar). For now, it accepts
 * a JSON config via stdin or command-line argument.
 */
async function main(): Promise<void> {
  console.log("SkillsHub Runner starting...");

  const configArg = process.argv[2];

  if (!configArg) {
    console.log("Usage: node index.js <run-config-json>");
    console.log("  Or pipe JSON config via stdin");
    console.log("");
    console.log("Runner is ready. Waiting for run requests...");
    // In production: start listening on queue/HTTP
    return;
  }

  let config: RunConfig;
  try {
    config = JSON.parse(configArg) as RunConfig;
  } catch {
    console.error("Failed to parse run config JSON");
    process.exit(1);
  }

  console.log(`Executing run ${config.runId} with backend ${config.providerConfig.backend}...`);

  try {
    const result = await executeRun(config);
    console.log("Run completed:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Run failed:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
