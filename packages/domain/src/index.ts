import { z } from "zod";

// ─── Existing Schemas (from PR #1) ─────────────────────────────

export const BackendSchema = z.enum(["claude-code", "codex"]);
export type Backend = z.infer<typeof BackendSchema>;

export const ProviderSchema = z.enum(["anthropic", "openai"]);
export type Provider = z.infer<typeof ProviderSchema>;

export const ModelConfigSchema = z.object({
  backend: BackendSchema,
  provider: ProviderSchema,
  modelId: z.string(),
  maxTurns: z.number().optional(),
  allowedTools: z.array(z.string()).optional(),
  additionalFlags: z.record(z.string()).optional(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ToolConfigSchema = z.object({
  allowFileIO: z.boolean(),
  allowNetwork: z.boolean(),
  allowShell: z.boolean().optional(),
});
export type ToolConfig = z.infer<typeof ToolConfigSchema>;

export const IterationStartPayloadSchema = z.object({
  skillVersionId: z.string(),
  evalSetId: z.string(),
  baselineMode: z.enum(["without_skill", "old_skill"]),
  modelConfig: ModelConfigSchema,
  toolConfig: ToolConfigSchema,
});
export type IterationStartPayload = z.infer<typeof IterationStartPayloadSchema>;

/**
 * Maps a backend type to its underlying API provider.
 */
export function providerForBackend(
  backend: z.infer<typeof BackendSchema>,
): z.infer<typeof ProviderSchema> {
  switch (backend) {
    case "claude-code":
      return "anthropic";
    case "codex":
      return "openai";
  }
}

// ─── State Machine Enums (§8.1–8.7) ────────────────────────────

export const ProjectStatusSchema = z.enum(["draft", "active", "archived"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/** §8.1: draft → frozen → accepted → superseded */
export const SkillVersionStatusSchema = z.enum([
  "draft",
  "frozen",
  "accepted",
  "superseded",
]);
export type SkillVersionStatus = z.infer<typeof SkillVersionStatusSchema>;

/** §8.2: draft → frozen */
export const EvalSetStatusSchema = z.enum(["draft", "frozen"]);
export type EvalSetStatus = z.infer<typeof EvalSetStatusSchema>;

/** §8.3: queued → provisioning → running → result_received → finalizing → succeeded
 *  Failure: provisioning_failed | running_failed | timed_out | finalization_failed | canceled */
export const RunStatusSchema = z.enum([
  "queued",
  "provisioning",
  "running",
  "result_received",
  "finalizing",
  "succeeded",
  "provisioning_failed",
  "running_failed",
  "timed_out",
  "finalization_failed",
  "canceled",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** §8.4: pending → awaiting_primary → awaiting_baseline → awaiting_comparable_retry
 *  → comparable → graded → included_in_benchmark | excluded */
export const ComparablePairStatusSchema = z.enum([
  "pending",
  "awaiting_primary",
  "awaiting_baseline",
  "awaiting_comparable_retry",
  "comparable",
  "graded",
  "included_in_benchmark",
  "excluded",
]);
export type ComparablePairStatus = z.infer<typeof ComparablePairStatusSchema>;

/** §8.5: drafting → queued → running → awaiting_pair_finalization → awaiting_grading
 *  → benchmark_ready → review_open → review_submitted → completed
 *  Exception: degraded | failed | canceled */
export const IterationStatusSchema = z.enum([
  "drafting",
  "queued",
  "running",
  "awaiting_pair_finalization",
  "awaiting_grading",
  "benchmark_ready",
  "review_open",
  "review_submitted",
  "completed",
  "degraded",
  "failed",
  "canceled",
]);
export type IterationStatus = z.infer<typeof IterationStatusSchema>;

/** §8.6: open → submitted → closed; open → stale */
export const ReviewSessionStatusSchema = z.enum([
  "open",
  "submitted",
  "closed",
  "stale",
]);
export type ReviewSessionStatus = z.infer<typeof ReviewSessionStatusSchema>;

/** §8.7: draft_evals → awaiting_eval_review → queued → running → completed | failed | canceled */
export const OptimizationJobStatusSchema = z.enum([
  "draft_evals",
  "awaiting_eval_review",
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
]);
export type OptimizationJobStatus = z.infer<typeof OptimizationJobStatusSchema>;

export const ReviewGateStatusSchema = z.enum([
  "locked",
  "open",
  "submitted",
  "waived",
]);
export type ReviewGateStatus = z.infer<typeof ReviewGateStatusSchema>;

export const ArtifactManifestStatusSchema = z.enum([
  "staging",
  "complete_unverified",
  "committed",
]);
export type ArtifactManifestStatus = z.infer<
  typeof ArtifactManifestStatusSchema
>;

export const SkillFileKindSchema = z.enum([
  "skill_md",
  "script",
  "reference",
  "asset",
]);
export type SkillFileKind = z.infer<typeof SkillFileKindSchema>;

export const AssertionTypeSchema = z.enum([
  "file_exists",
  "filename_pattern",
  "text_contains",
  "regex_match",
  "json_schema",
  "csv_column_exists",
  "artifact_type",
  "script_custom",
  "human_only",
]);
export type AssertionType = z.infer<typeof AssertionTypeSchema>;

export const RunModeSchema = z.enum([
  "with_skill",
  "without_skill",
  "old_skill",
]);
export type RunMode = z.infer<typeof RunModeSchema>;

// ─── State Transition Maps (enforce §8 rules) ──────────────────

const SKILL_VERSION_TRANSITIONS: Record<
  SkillVersionStatus,
  SkillVersionStatus[]
> = {
  draft: ["frozen"],
  frozen: ["accepted"],
  accepted: ["superseded"],
  superseded: [],
};

const EVAL_SET_TRANSITIONS: Record<EvalSetStatus, EvalSetStatus[]> = {
  draft: ["frozen"],
  frozen: [],
};

const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ["provisioning", "canceled"],
  provisioning: ["running", "provisioning_failed", "canceled"],
  running: ["result_received", "running_failed", "timed_out", "canceled"],
  result_received: ["finalizing"],
  finalizing: ["succeeded", "finalization_failed"],
  succeeded: [],
  provisioning_failed: [],
  running_failed: [],
  timed_out: [],
  finalization_failed: [],
  canceled: [],
};

const COMPARABLE_PAIR_TRANSITIONS: Record<
  ComparablePairStatus,
  ComparablePairStatus[]
> = {
  pending: ["awaiting_primary", "awaiting_baseline", "excluded"],
  awaiting_primary: ["comparable", "awaiting_comparable_retry", "excluded"],
  awaiting_baseline: ["comparable", "awaiting_comparable_retry", "excluded"],
  awaiting_comparable_retry: [
    "awaiting_primary",
    "awaiting_baseline",
    "excluded",
  ],
  comparable: ["graded", "excluded"],
  graded: ["included_in_benchmark", "excluded"],
  included_in_benchmark: [],
  excluded: [],
};

const ITERATION_TRANSITIONS: Record<IterationStatus, IterationStatus[]> = {
  drafting: ["queued", "canceled"],
  queued: ["running", "failed", "canceled"],
  running: [
    "awaiting_pair_finalization",
    "degraded",
    "failed",
    "canceled",
  ],
  awaiting_pair_finalization: ["awaiting_grading", "degraded", "failed"],
  awaiting_grading: ["benchmark_ready", "failed"],
  benchmark_ready: ["review_open"],
  review_open: ["review_submitted"],
  review_submitted: ["completed"],
  completed: [],
  degraded: [],
  failed: [],
  canceled: [],
};

const REVIEW_SESSION_TRANSITIONS: Record<
  ReviewSessionStatus,
  ReviewSessionStatus[]
> = {
  open: ["submitted", "closed", "stale"],
  submitted: ["closed"],
  closed: [],
  stale: [],
};

/** Throws if the transition is not allowed by the §8.1 state machine. */
export function assertValidSkillVersionTransition(
  from: SkillVersionStatus,
  to: SkillVersionStatus,
): void {
  if (!SKILL_VERSION_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid SkillVersion transition: ${from} → ${to}`);
  }
}

/** Throws if the transition is not allowed by the §8.2 state machine. */
export function assertValidEvalSetTransition(
  from: EvalSetStatus,
  to: EvalSetStatus,
): void {
  if (!EVAL_SET_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid EvalSet transition: ${from} → ${to}`);
  }
}

/** Throws if the transition is not allowed by the §8.3 state machine. */
export function assertValidRunTransition(
  from: RunStatus,
  to: RunStatus,
): void {
  if (!RUN_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid Run transition: ${from} → ${to}`);
  }
}

/** Throws if the transition is not allowed by the §8.4 state machine. */
export function assertValidComparablePairTransition(
  from: ComparablePairStatus,
  to: ComparablePairStatus,
): void {
  if (!COMPARABLE_PAIR_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid ComparablePair transition: ${from} → ${to}`);
  }
}

/** Throws if the transition is not allowed by the §8.5 state machine. */
export function assertValidIterationTransition(
  from: IterationStatus,
  to: IterationStatus,
): void {
  if (!ITERATION_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid Iteration transition: ${from} → ${to}`);
  }
}

/** Throws if the transition is not allowed by the §8.6 state machine. */
export function assertValidReviewSessionTransition(
  from: ReviewSessionStatus,
  to: ReviewSessionStatus,
): void {
  if (!REVIEW_SESSION_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid ReviewSession transition: ${from} → ${to}`);
  }
}

// ─── API Payloads (§22.1–22.4) ─────────────────────────────────

/** §22.2 Runner job payload — sent to the runner for each run */
export const RunnerJobPayloadSchema = z.object({
  runId: z.string(),
  iterationId: z.string(),
  evalSnapshotId: z.string(),
  skillBundleUri: z.string().nullable(),
  prompt: z.string(),
  inputFilesManifest: z.array(
    z.object({
      path: z.string(),
      s3Key: z.string(),
    }),
  ),
  executionEnvelope: z.object({
    comparabilityHash: z.string(),
  }),
  outputPrefix: z.string(),
});
export type RunnerJobPayload = z.infer<typeof RunnerJobPayloadSchema>;

/** §22.3 Runner result payload — returned by the runner after execution */
export const RunnerResultPayloadSchema = z.object({
  runId: z.string(),
  sandboxId: z.string().nullable(),
  exitStatus: z.enum(["success", "failure", "timeout"]),
  totalTokens: z.number(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  durationMs: z.number(),
  costUsd: z.number().nullable(),
  transcriptUri: z.string(),
  outputFiles: z.array(
    z.object({
      path: z.string(),
      sha256: z.string(),
    }),
  ),
  stdoutUri: z.string().nullable(),
  stderrUri: z.string().nullable(),
});
export type RunnerResultPayload = z.infer<typeof RunnerResultPayloadSchema>;

/** §22.4 Review submission payload */
export const ReviewSubmissionPayloadSchema = z.object({
  reviewSessionId: z.string(),
  benchmarkHash: z.string(),
  reviews: z.array(
    z.object({
      runId: z.string(),
      runManifestHash: z.string(),
      feedback: z.string(),
    }),
  ),
});
export type ReviewSubmissionPayload = z.infer<
  typeof ReviewSubmissionPayloadSchema
>;

// ─── Budget Types (§18) ─────────────────────────────────────────

/** §18.2 Per-project budget policies */
export const BudgetPolicySchema = z.object({
  maxEstimatedCostUsd: z.number().optional(),
  maxIterationCostUsd: z.number().optional(),
  maxTotalTokens: z.number().optional(),
  maxConcurrentRuns: z.number().optional(),
  abortAfterCriticalFailures: z.number().optional(),
});
export type BudgetPolicy = z.infer<typeof BudgetPolicySchema>;

/** §18.1 Pre-flight cost estimate */
export const CostEstimateSchema = z.object({
  estimatedTokens: z.number(),
  estimatedCostUsd: z.number(),
  estimatedWallClockMs: z.number(),
  estimatedConcurrency: z.number(),
});
export type CostEstimate = z.infer<typeof CostEstimateSchema>;

// ─── Grading Output (§15.1) ────────────────────────────────────

/** §15.1 Exact grading output structure per PRD */
export const GradingOutputSchema = z.object({
  expectations: z.array(
    z.object({
      text: z.string(),
      passed: z.boolean(),
      evidence: z.string(),
    }),
  ),
});
export type GradingOutput = z.infer<typeof GradingOutputSchema>;
