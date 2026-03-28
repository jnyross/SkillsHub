import { createHash } from "node:crypto";

export type BackendType = "claude-code" | "codex";

export type ExecutionEnvelope = {
  runId: string;
  iterationId: string;
  evalCaseId: string;
  mode: "with_skill" | "without_skill" | "old_skill";
  backend: BackendType;
  provider: "anthropic" | "openai";
  modelId: string;
  runnerVersion: string;
  toolConfig: ToolConfig;
  startedAt: string;
  completedAt?: string;
  status: "pending" | "running" | "completed" | "failed" | "timeout";
};

export type ToolConfig = {
  allowFileIO: boolean;
  allowNetwork: boolean;
  allowShell?: boolean;
};

/**
 * Fields included in the comparability hash.
 * Both sides of a comparable pair MUST have identical values for all these fields.
 * Notably, `backend` IS included — you cannot compare a Claude Code run against a Codex run.
 */
const COMPARABILITY_FIELDS: ReadonlyArray<keyof ExecutionEnvelope> = [
  "evalCaseId",
  "backend",
  "provider",
  "modelId",
  "runnerVersion",
] as const;

/**
 * Fields allowed to differ between comparable runs.
 * `backend` is NOT in this list — both sides must use the same backend.
 */
export const ALLOWED_DIFFERENCE_FIELDS: ReadonlyArray<keyof ExecutionEnvelope> = [
  "runId",
  "iterationId",
  "mode",
  "startedAt",
  "completedAt",
  "status",
] as const;

/**
 * Computes a comparability hash for an execution envelope.
 * Two runs are comparable (can form a pair) only if they share the same hash.
 */
export function comparabilityHash(envelope: ExecutionEnvelope): string {
  const data: Record<string, string | boolean> = {};

  for (const field of COMPARABILITY_FIELDS) {
    const value = envelope[field];
    data[field] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }

  // Include tool config in comparability
  data["toolConfig"] = JSON.stringify(envelope.toolConfig);

  const serialized = JSON.stringify(data, Object.keys(data).sort());
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Determines if two execution envelopes can form a comparable pair.
 */
export function areComparable(a: ExecutionEnvelope, b: ExecutionEnvelope): boolean {
  return comparabilityHash(a) === comparabilityHash(b);
}
