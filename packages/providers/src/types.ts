export type BackendType = "claude-code" | "codex";

export type ProviderConfig = {
  backend: BackendType;
  modelId: string;
  maxTurns?: number;
  timeoutSeconds: number;
  allowedTools?: string[];
  additionalFlags?: Record<string, string>;
};

export type ProviderResult = {
  exitCode: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number | null;
  transcript: TranscriptEntry[];
  outputText: string;
};

export type TranscriptEntry = {
  role: "user" | "assistant" | "tool_use" | "tool_result";
  content: string;
  timestamp: string;
  tokenCount?: number;
};
