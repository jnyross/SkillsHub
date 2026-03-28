import { spawn } from "node:child_process";
import type { ProviderConfig, ProviderResult, TranscriptEntry } from "./types.js";

interface ClaudeJsonOutput {
  result?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  cost_usd?: number;
  conversation?: Array<{
    role: string;
    content: string;
  }>;
}

function buildArgs(config: ProviderConfig, prompt: string): string[] {
  const args: string[] = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--model",
    config.modelId,
  ];

  if (config.maxTurns !== undefined) {
    args.push("--max-turns", String(config.maxTurns));
  }

  if (config.allowedTools && config.allowedTools.length > 0) {
    args.push("--allowedTools", config.allowedTools.join(","));
  }

  if (config.additionalFlags) {
    for (const [key, value] of Object.entries(config.additionalFlags)) {
      args.push(`--${key}`, value);
    }
  }

  return args;
}

function parseTranscript(conversation: Array<{ role: string; content: string }> | undefined): TranscriptEntry[] {
  if (!conversation) return [];

  const now = new Date().toISOString();
  return conversation.map((entry) => ({
    role: entry.role as TranscriptEntry["role"],
    content: typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content),
    timestamp: now,
  }));
}

export async function runClaudeCode(
  config: ProviderConfig,
  workdir: string,
  prompt: string,
): Promise<ProviderResult> {
  const args = buildArgs(config, prompt);
  const startTime = Date.now();

  return new Promise<ProviderResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let killed = false;
    let exited = false;

    const child = spawn("claude", args, {
      cwd: workdir,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] ?? "",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!exited) {
          child.kill("SIGKILL");
        }
      }, 5000);
    }, config.timeoutSeconds * 1000);

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      exited = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (killed) {
        resolve({
          exitCode: 124,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          durationMs,
          costUsd: null,
          transcript: [],
          outputText: `Process timed out after ${config.timeoutSeconds}s. stderr: ${stderr}`,
        });
        return;
      }

      let parsed: ClaudeJsonOutput | null = null;
      try {
        parsed = JSON.parse(stdout) as ClaudeJsonOutput;
      } catch {
        // JSON parse failed — raw output mode
      }

      const inputTokens = parsed?.usage?.input_tokens ?? 0;
      const outputTokens = parsed?.usage?.output_tokens ?? 0;
      const totalTokens = inputTokens + outputTokens;
      const costUsd = parsed?.cost_usd ?? null;
      const outputText = parsed?.result ?? stdout;
      const transcript = parseTranscript(parsed?.conversation);

      resolve({
        exitCode: code ?? 1,
        totalTokens,
        inputTokens,
        outputTokens,
        durationMs,
        costUsd,
        transcript,
        outputText,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      resolve({
        exitCode: 127,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs,
        costUsd: null,
        transcript: [],
        outputText: `Failed to spawn claude CLI: ${err.message}`,
      });
    });
  });
}
