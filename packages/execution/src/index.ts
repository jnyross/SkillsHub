import { createHash } from "node:crypto";

/** Full execution envelope matching PRD §4.13 + §9.1.
 *  All fields from the PRD, including `backend` from PR #1. */
export type ExecutionEnvelope = {
  id: string;
  runId: string;
  iterationId: string;
  evalSnapshotId: string;

  // Model identity
  provider: string;
  modelId: string;
  modelConfigHash: string;
  systemPromptHash: string;
  backend: "claude-code" | "codex";

  // Tool surface
  toolPolicyHash: string;
  toolListHash: string;
  promptWrapperHash: string;

  // Runner identity
  runnerImageDigest: string;
  runnerVersion: string;
  transcriptSchemaVersion: string;

  // Input identity
  inputManifestHash: string;
  inputFilesHash: string;
  timeoutSeconds: number;
  resourceProfileHash: string;
  envAllowlistHash: string;

  // Skill context (§9.2: these are the ONLY allowed differences in a pair)
  skillMode: "with_skill" | "without_skill" | "old_skill";
  skillBundleHash: string | null;
  availableSkillsContextHash: string;

  // Retry
  retryPolicyHash: string;

  // Computed
  comparabilityHash: string;
  createdAt: string;
};

/** §9.2: Fields that are excluded from the comparability hash.
 *  Only these fields may differ between runs in a comparable pair. */
export const ALLOWED_DIFFERENCE_FIELDS = [
  "id",
  "runId",
  "skillMode",
  "skillBundleHash",
  "availableSkillsContextHash",
  "comparabilityHash",
  "createdAt",
] as const;

/** Fields that contribute to the comparability hash.
 *  All fields from the envelope EXCEPT those in ALLOWED_DIFFERENCE_FIELDS. */
export const COMPARABILITY_FIELDS = [
  "iterationId",
  "evalSnapshotId",
  "provider",
  "modelId",
  "modelConfigHash",
  "systemPromptHash",
  "backend",
  "toolPolicyHash",
  "toolListHash",
  "promptWrapperHash",
  "runnerImageDigest",
  "runnerVersion",
  "transcriptSchemaVersion",
  "inputManifestHash",
  "inputFilesHash",
  "timeoutSeconds",
  "resourceProfileHash",
  "envAllowlistHash",
  "retryPolicyHash",
] as const;

/** §9.3: Compute comparabilityHash from ALL non-allowed fields.
 *  The hash proves: same environment, same input, same tool surface,
 *  same model behavior envelope, same timeout/retry envelope. */
export function computeComparabilityHash(
  envelope: Omit<ExecutionEnvelope, "comparabilityHash" | "createdAt">,
): string {
  const data: Record<string, string | number> = {};

  for (const field of COMPARABILITY_FIELDS) {
    const value = envelope[field];
    data[field] = typeof value === "number" ? value : String(value);
  }

  const sorted = JSON.stringify(data, Object.keys(data).sort());
  return `sha256:${createHash("sha256").update(sorted).digest("hex")}`;
}

/** Check if two envelopes can form a comparable pair (§7.2). */
export function areComparable(
  a: ExecutionEnvelope,
  b: ExecutionEnvelope,
): boolean {
  return a.comparabilityHash === b.comparabilityHash;
}

/** Utility: hash an arbitrary string for envelope fields. */
export function hashField(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Build a full execution envelope from run context.
 *  Called when creating a run, before dispatch to the runner. */
export function buildExecutionEnvelope(input: {
  id: string;
  runId: string;
  iterationId: string;
  evalSnapshotId: string;
  provider: string;
  modelId: string;
  modelConfig: Record<string, unknown>;
  systemPrompt: string;
  backend: "claude-code" | "codex";
  toolPolicy: Record<string, unknown>;
  toolList: string[];
  promptWrapper: string;
  runnerImageDigest: string;
  runnerVersion: string;
  inputManifest: Array<{ path: string; sha256: string }>;
  inputFiles: Array<{ path: string; content: string }>;
  timeoutSeconds: number;
  resourceProfile: Record<string, unknown>;
  envAllowlist: string[];
  skillMode: "with_skill" | "without_skill" | "old_skill";
  skillBundleHash: string | null;
  availableSkillsContextHash: string;
  retryPolicy: Record<string, unknown>;
}): ExecutionEnvelope {
  const envelope: Omit<ExecutionEnvelope, "comparabilityHash"> = {
    id: input.id,
    runId: input.runId,
    iterationId: input.iterationId,
    evalSnapshotId: input.evalSnapshotId,
    provider: input.provider,
    modelId: input.modelId,
    modelConfigHash: hashField(
      JSON.stringify(input.modelConfig, Object.keys(input.modelConfig).sort()),
    ),
    systemPromptHash: hashField(input.systemPrompt),
    backend: input.backend,
    toolPolicyHash: hashField(
      JSON.stringify(input.toolPolicy, Object.keys(input.toolPolicy).sort()),
    ),
    toolListHash: hashField(JSON.stringify([...input.toolList].sort())),
    promptWrapperHash: hashField(input.promptWrapper),
    runnerImageDigest: input.runnerImageDigest,
    runnerVersion: input.runnerVersion,
    transcriptSchemaVersion: "1",
    inputManifestHash: hashField(JSON.stringify(input.inputManifest)),
    inputFilesHash: hashField(JSON.stringify(input.inputFiles)),
    timeoutSeconds: input.timeoutSeconds,
    resourceProfileHash: hashField(
      JSON.stringify(
        input.resourceProfile,
        Object.keys(input.resourceProfile).sort(),
      ),
    ),
    envAllowlistHash: hashField(
      JSON.stringify([...input.envAllowlist].sort()),
    ),
    skillMode: input.skillMode,
    skillBundleHash: input.skillBundleHash,
    availableSkillsContextHash: input.availableSkillsContextHash,
    retryPolicyHash: hashField(
      JSON.stringify(input.retryPolicy, Object.keys(input.retryPolicy).sort()),
    ),
    createdAt: new Date().toISOString(),
  };

  return {
    ...envelope,
    comparabilityHash: computeComparabilityHash(envelope),
  };
}
