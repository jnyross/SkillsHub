export type {
  BackendType,
  ProviderConfig,
  ProviderResult,
  TranscriptEntry,
} from "./types.js";

import type { ProviderConfig, ProviderResult } from "./types.js";
import { runClaudeCode } from "./claude-code.js";
import { runCodex } from "./codex.js";

export { runClaudeCode } from "./claude-code.js";
export { runCodex } from "./codex.js";

export async function executeWithProvider(
  config: ProviderConfig,
  workdir: string,
  prompt: string,
): Promise<ProviderResult> {
  switch (config.backend) {
    case "claude-code":
      return runClaudeCode(config, workdir, prompt);
    case "codex":
      return runCodex(config, workdir, prompt);
    default:
      throw new Error(`Unknown backend: ${String((config as Record<string, unknown>).backend)}`);
  }
}
