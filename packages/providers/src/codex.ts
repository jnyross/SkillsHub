import { spawn } from "node:child_process";
import type { ProviderConfig, ProviderResult, TranscriptEntry } from "./types.js";

function buildArgs(config: ProviderConfig, prompt: string): string[] {
  const args: string[] = [
    "--model",
    config.modelId,
    "--approval-mode",
    "full-auto",
    "--quiet",
  ];

  if (config.additionalFlags) {
    for (const [key, value] of Object.entries(config.additionalFlags)) {
      args.push(`--${key}`, value);
    }
  }

  args.push(prompt);

  return args;
}

interface CodexUsageMatch {
  inputTokens: number;
  outputTokens: number;
}

function parseUsageFromOutput(output: string): CodexUsageMatch {
  let inputTokens = 0;
  let outputTokens = 0;

  const inputMatch = output.match(/input[_\s]tokens?[:\s]+(\d+)/i);
  if (inputMatch?.[1]) {
    inputTokens = parseInt(inputMatch[1], 10);
  }

  const outputMatch = output.match(/output[_\s]tokens?[:\s]+(\d+)/i);
  if (outputMatch?.[1]) {
    outputTokens = parseInt(outputMatch[1], 10);
  }

  return { inputTokens, outputTokens };
}

function parseTranscriptFromOutput(output: string): TranscriptEntry[] {
  const lines = output.split("\n").filter((line) => line.trim().length > 0);
  const entries: TranscriptEntry[] = [];
  const now = new Date().toISOString();

  let currentRole: TranscriptEntry["role"] = "assistant";
  let currentContent: string[] = [];

  for (const line of lines) {
    const toolUseMatch = line.match(/^>\s*(.+)/);
    const toolResultMatch = line.match(/^<\s*(.+)/);

    if (toolUseMatch?.[1]) {
      if (currentContent.length > 0) {
        entries.push({
          role: currentRole,
          content: currentContent.join("\n"),
          timestamp: now,
        });
        currentContent = [];
      }
      currentRole = "tool_use";
      currentContent.push(toolUseMatch[1]);
    } else if (toolResultMatch?.[1]) {
      if (currentContent.length > 0) {
        entries.push({
          role: currentRole,
          content: currentContent.join("\n"),
          timestamp: now,
        });
        currentContent = [];
      }
      currentRole = "tool_result";
      currentContent.push(toolResultMatch[1]);
    } else {
      if (currentRole === "tool_use" || currentRole === "tool_result") {
        if (currentContent.length > 0) {
          entries.push({
            role: currentRole,
            content: currentContent.join("\n"),
            timestamp: now,
          });
          currentContent = [];
        }
        currentRole = "assistant";
      }
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0) {
    entries.push({
      role: currentRole,
      content: currentContent.join("\n"),
      timestamp: now,
    });
  }

  return entries;
}

export async function runCodex(
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

    const child = spawn("codex", args, {
      cwd: workdir,
      env: {
        ...process.env,
        OPENAI_API_KEY: process.env["OPENAI_API_KEY"] ?? "",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
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

      const combinedOutput = stdout + stderr;
      const usage = parseUsageFromOutput(combinedOutput);
      const totalTokens = usage.inputTokens + usage.outputTokens;
      const transcript = parseTranscriptFromOutput(stdout);

      resolve({
        exitCode: code ?? 1,
        totalTokens,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs,
        costUsd: null, // Codex CLI does not provide cost info directly
        transcript,
        outputText: stdout,
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
        outputText: `Failed to spawn codex CLI: ${err.message}`,
      });
    });
  });
}
