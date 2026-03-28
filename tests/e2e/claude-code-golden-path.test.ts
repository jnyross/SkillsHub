import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { executeWithProvider } from "@skillshub/providers";
import type { ProviderConfig, ProviderResult } from "@skillshub/providers";
import { comparabilityHash } from "@skillshub/execution";
import type { ExecutionEnvelope } from "@skillshub/execution";
import { ModelConfigSchema } from "@skillshub/domain";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "fixtures");
const BACKEND = "claude-code" as const;
const MODEL_ID = "claude-sonnet-4-20250514";

describe("Claude Code Golden Path E2E", () => {
  let workdirBase: string;

  beforeAll(() => {
    // Skip if Claude Code is not available
    if (!process.env["ANTHROPIC_API_KEY"]) {
      console.log("Skipping Claude Code tests: ANTHROPIC_API_KEY not set");
      return;
    }

    workdirBase = path.join("/tmp", `skillshub-e2e-claude-${Date.now()}`);
    fs.mkdirSync(workdirBase, { recursive: true });
  });

  it("should validate model config schema for claude-code backend", () => {
    const config = {
      backend: "claude-code",
      provider: "anthropic",
      modelId: MODEL_ID,
      maxTurns: 50,
    };

    const result = ModelConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backend).toBe("claude-code");
      expect(result.data.provider).toBe("anthropic");
    }
  });

  it("should create comparable execution envelopes for same backend", () => {
    const baseEnvelope: ExecutionEnvelope = {
      runId: "run_1",
      iterationId: "iter_1",
      evalCaseId: "eval-001",
      mode: "with_skill",
      backend: "claude-code",
      provider: "anthropic",
      modelId: MODEL_ID,
      runnerVersion: "claude-code@1.0.0",
      toolConfig: { allowFileIO: true, allowNetwork: false },
      startedAt: new Date().toISOString(),
      status: "pending",
    };

    const pairedEnvelope: ExecutionEnvelope = {
      ...baseEnvelope,
      runId: "run_2",
      mode: "without_skill",
      startedAt: new Date().toISOString(),
    };

    // Same backend = same comparability hash
    expect(comparabilityHash(baseEnvelope)).toBe(comparabilityHash(pairedEnvelope));
  });

  it("should run a trivial prompt through Claude Code backend", async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      console.log("Skipping: ANTHROPIC_API_KEY not set");
      return;
    }

    const workdir = path.join(workdirBase, "trivial-run");
    fs.mkdirSync(workdir, { recursive: true });

    const config: ProviderConfig = {
      backend: BACKEND,
      modelId: MODEL_ID,
      timeoutSeconds: 120,
      maxTurns: 3,
    };

    const result = await executeWithProvider(config, workdir, 'Echo "hello" to stdout and nothing else.');

    expect(result.exitCode).toBeDefined();
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.outputText).toBeDefined();
    expect(result.outputText.length).toBeGreaterThan(0);
  }, 180_000);

  it("should run skill-based eval through Claude Code backend", async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      console.log("Skipping: ANTHROPIC_API_KEY not set");
      return;
    }

    const evalData = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "sample-evals", "eval-001.json"), "utf-8"),
    ) as {
      prompt: string;
      inputFiles: Array<{ key: string; content: string }>;
      assertions: Array<{ type: string; path?: string; value?: string | number }>;
    };

    const workdir = path.join(workdirBase, "skill-eval-run");
    const inputsDir = path.join(workdir, "inputs");
    const outputsDir = path.join(workdir, "outputs");
    const skillDir = path.join(workdir, "skill");

    fs.mkdirSync(inputsDir, { recursive: true });
    fs.mkdirSync(outputsDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });

    // Copy skill files
    const skillMd = fs.readFileSync(path.join(FIXTURES_DIR, "sample-skill", "SKILL.md"), "utf-8");
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd);

    // Write input files
    for (const file of evalData.inputFiles) {
      fs.writeFileSync(path.join(inputsDir, file.key), file.content);
    }

    // Build prompt with skill context
    const fullPrompt = `# Skill Context\n\n${skillMd}\n\n# Task\n\n${evalData.prompt}\n\nWorking directory layout:\n- ./inputs/ — input files for this task\n- ./outputs/ — place your output files here\n- ./skill/ — skill reference files`;

    const config: ProviderConfig = {
      backend: BACKEND,
      modelId: MODEL_ID,
      timeoutSeconds: 180,
      maxTurns: 10,
    };

    const result = await executeWithProvider(config, workdir, fullPrompt);

    // Verify basic run success
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.outputText.length).toBeGreaterThan(0);

    // Verify timing data is captured
    expect(result.totalTokens).toBeDefined();
    expect(result.inputTokens).toBeDefined();
    expect(result.outputTokens).toBeDefined();

    // Verify transcript exists
    expect(result.transcript).toBeDefined();
    expect(Array.isArray(result.transcript)).toBe(true);

    // Check assertions
    for (const assertion of evalData.assertions) {
      if (assertion.type === "file_exists" && assertion.path) {
        const filePath = path.join(workdir, assertion.path);
        expect(fs.existsSync(filePath)).toBe(true);
      }
      if (assertion.type === "content_contains" && assertion.path && typeof assertion.value === "string") {
        const filePath = path.join(workdir, assertion.path);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8");
          expect(content).toContain(assertion.value);
        }
      }
    }
  }, 300_000);

  it("should capture timing data in correct format", async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      console.log("Skipping: ANTHROPIC_API_KEY not set");
      return;
    }

    const workdir = path.join(workdirBase, "timing-run");
    fs.mkdirSync(workdir, { recursive: true });

    const config: ProviderConfig = {
      backend: BACKEND,
      modelId: MODEL_ID,
      timeoutSeconds: 60,
      maxTurns: 2,
    };

    const result = await executeWithProvider(config, workdir, "Say hello.");

    // Build timing.json as the runner would
    const timing = {
      runId: "test_run",
      totalTokens: result.totalTokens,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      capturedAt: new Date().toISOString(),
    };

    expect(timing.runId).toBe("test_run");
    expect(timing.durationMs).toBeGreaterThan(0);
    expect(typeof timing.capturedAt).toBe("string");
    expect(new Date(timing.capturedAt).getTime()).toBeGreaterThan(0);
  }, 120_000);

  it("should generate transcript in ndjson format", async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      console.log("Skipping: ANTHROPIC_API_KEY not set");
      return;
    }

    const workdir = path.join(workdirBase, "transcript-run");
    fs.mkdirSync(workdir, { recursive: true });

    const config: ProviderConfig = {
      backend: BACKEND,
      modelId: MODEL_ID,
      timeoutSeconds: 60,
      maxTurns: 2,
    };

    const result = await executeWithProvider(config, workdir, "Say hello.");

    // Build ndjson as the runner would
    const ndjson = result.transcript.map((entry) => JSON.stringify(entry)).join("\n") + "\n";

    // Verify each line is valid JSON
    const lines = ndjson.trim().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        expect(parsed).toHaveProperty("role");
        expect(parsed).toHaveProperty("content");
        expect(parsed).toHaveProperty("timestamp");
      }
    }
  }, 120_000);
});
