import * as fs from "node:fs";
import * as path from "node:path";
import { executeWithProvider } from "@skillshub/providers";
import type { ProviderConfig } from "@skillshub/providers";

/**
 * Quick smoke test that runs a trivial prompt through each backend
 * to verify the setup is working.
 *
 * Usage:
 *   node smoke-test.js --backend claude-code
 *   node smoke-test.js --backend codex
 *   node smoke-test.js --backend both
 */
async function main(): Promise<void> {
  const backendArg = process.argv.find((a) => a.startsWith("--backend"))
    ? process.argv[process.argv.indexOf("--backend") + 1]
    : "both";

  const backends = backendArg === "both" ? ["claude-code", "codex"] as const : [backendArg] as const;
  const prompt = 'Create a file called "hello.txt" containing the text "Hello from SkillsHub smoke test!"';

  for (const backend of backends) {
    console.log(`\n--- Smoke testing backend: ${backend} ---\n`);

    const workdir = path.join("/tmp", `skillshub-smoke-${backend}-${Date.now()}`);
    fs.mkdirSync(workdir, { recursive: true });

    const config: ProviderConfig = {
      backend: backend as ProviderConfig["backend"],
      modelId: backend === "claude-code" ? "claude-sonnet-4-20250514" : "o4-mini",
      timeoutSeconds: 120,
      maxTurns: 5,
    };

    // Verify API key is set
    if (backend === "claude-code" && !process.env["ANTHROPIC_API_KEY"]) {
      console.error("ERROR: ANTHROPIC_API_KEY is not set");
      process.exit(1);
    }
    if (backend === "codex" && !process.env["OPENAI_API_KEY"]) {
      console.error("ERROR: OPENAI_API_KEY is not set");
      process.exit(1);
    }

    try {
      const result = await executeWithProvider(config, workdir, prompt);

      console.log(`Exit code: ${result.exitCode}`);
      console.log(`Duration: ${result.durationMs}ms`);
      console.log(`Tokens: ${result.totalTokens} (in: ${result.inputTokens}, out: ${result.outputTokens})`);
      console.log(`Cost: ${result.costUsd !== null ? `$${result.costUsd.toFixed(4)}` : "N/A"}`);
      console.log(`Transcript entries: ${result.transcript.length}`);
      console.log(`Output preview: ${result.outputText.substring(0, 200)}`);

      // Check if the expected file was created
      const helloPath = path.join(workdir, "hello.txt");
      if (fs.existsSync(helloPath)) {
        console.log(`\nFile created: ${helloPath}`);
        console.log(`Contents: ${fs.readFileSync(helloPath, "utf-8").trim()}`);
        console.log(`\n${backend} smoke test PASSED`);
      } else {
        console.log(`\nWARNING: Expected file hello.txt was not created in workdir`);
        console.log(`${backend} smoke test INCOMPLETE (file not found)`);
      }
    } catch (err) {
      console.error(`${backend} smoke test FAILED:`, err);
      process.exit(1);
    } finally {
      // Clean up
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }

  console.log("\nAll smoke tests completed.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
