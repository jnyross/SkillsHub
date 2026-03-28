import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createProject } from "../repositories/project-repo.js";
import { createSkill, createDraftVersion, freezeVersion } from "../repositories/skill-repo.js";
import { createEvalSet, addEvalCase, addAssertion, freezeEvalSet } from "../repositories/eval-repo.js";
import { createIteration } from "../repositories/iteration-repo.js";
import { transitionRunStatus, persistRunMetrics, createRetryRun, getRun } from "../repositories/run-repo.js";

const cleanupClient = new PrismaClient();

beforeAll(async () => {
  await cleanupClient.$connect();
});

afterAll(async () => {
  await cleanupClient.$disconnect();
});

beforeEach(async () => {
  await cleanupClient.$executeRaw`TRUNCATE TABLE "AuditEvent" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "Review" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "ReviewSession" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "Benchmark" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "Grade" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "RunMetrics" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "ComparablePair" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "Run" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "IterationEvalSnapshot" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "Iteration" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "ExecutionEnvelope" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "ArtifactManifest" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "Assertion" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "EvalCase" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "EvalSet" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "SkillFile" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "SkillVersion" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "Skill" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "ProjectBrief" CASCADE`;
  await cleanupClient.$executeRaw`TRUNCATE TABLE "Project" CASCADE`;
});

async function seedIterationWithRuns() {
  const project = await createProject({
    name: "Test",
    slug: `test-${Date.now()}`,
    ownerUserId: "user-1",
  });
  const skill = await createSkill({
    projectId: project.id,
    name: "Skill",
    slug: "skill",
  });
  const version = await createDraftVersion(skill.id, {
    frontmatterName: "Skill",
    frontmatterDescription: "desc",
    createdBy: "user-1",
  });
  const frozen = await freezeVersion(version.id);

  const evalSet = await createEvalSet({ projectId: project.id, name: "Evals" });
  const evalCase = await addEvalCase(evalSet.id, {
    slug: "case-1",
    prompt: "test prompt",
  });
  await addAssertion(evalCase.id, {
    text: "output exists",
    type: "file_exists",
  });
  const frozenEvals = await freezeEvalSet(evalSet.id);

  const result = await createIteration({
    projectId: project.id,
    skillVersionId: frozen.id,
    evalSetId: frozenEvals.id,
    baselineMode: "without_skill",
    modelConfigJson: "{}",
    toolConfigJson: "{}",
  });

  return { project, runIds: result.runIds, iteration: result.iteration };
}

describe("Run lifecycle (§8.3)", () => {
  it("transitions through full happy path", async () => {
    const { runIds } = await seedIterationWithRuns();
    const runId = runIds[0]!;

    let run = await transitionRunStatus(runId, "provisioning");
    expect(run.status).toBe("provisioning");
    expect(run.startedAt).toBeTruthy();

    run = await transitionRunStatus(runId, "running");
    expect(run.status).toBe("running");

    run = await transitionRunStatus(runId, "result_received");
    expect(run.status).toBe("result_received");
    expect(run.resultReceivedAt).toBeTruthy();

    run = await transitionRunStatus(runId, "finalizing");
    expect(run.status).toBe("finalizing");

    run = await transitionRunStatus(runId, "succeeded");
    expect(run.status).toBe("succeeded");
    expect(run.finalizedAt).toBeTruthy();
    expect(run.completedAt).toBeTruthy();
  });

  it("rejects invalid transitions", async () => {
    const { runIds } = await seedIterationWithRuns();
    const runId = runIds[0]!;

    await expect(
      transitionRunStatus(runId, "succeeded"),
    ).rejects.toThrow("Invalid Run transition: queued → succeeded");

    await expect(
      transitionRunStatus(runId, "running"),
    ).rejects.toThrow("Invalid Run transition: queued → running");
  });

  it("records failure reason", async () => {
    const { runIds } = await seedIterationWithRuns();
    const runId = runIds[0]!;

    await transitionRunStatus(runId, "provisioning");
    const run = await transitionRunStatus(runId, "provisioning_failed", {
      failureReason: "Container OOM",
    });

    expect(run.status).toBe("provisioning_failed");
    expect(run.failureReason).toBe("Container OOM");
    expect(run.completedAt).toBeTruthy();
  });
});

describe("Run metrics persistence (§1.3)", () => {
  it("persists metrics with capturedAt timestamp", async () => {
    const { runIds } = await seedIterationWithRuns();
    const runId = runIds[0]!;

    const metrics = await persistRunMetrics(runId, {
      totalTokens: 84852,
      durationMs: 23332,
      totalCostUsd: 0.42,
    });

    expect(metrics.runId).toBe(runId);
    expect(metrics.totalTokens).toBe(84852);
    expect(metrics.durationMs).toBe(23332);
    expect(metrics.totalCostUsd).toBeCloseTo(0.42);
    expect(metrics.capturedAt).toBeTruthy();

    // Verify via getRun
    const run = await getRun(runId);
    expect(run?.metrics).not.toBeNull();
    expect(run?.metrics?.totalTokens).toBe(84852);
  });
});

describe("Retry lineage (§17.1)", () => {
  it("creates retry run linked to parent", async () => {
    const { runIds } = await seedIterationWithRuns();
    const runId = runIds[0]!;

    // Fail the run first
    await transitionRunStatus(runId, "provisioning");
    await transitionRunStatus(runId, "provisioning_failed", {
      failureReason: "timeout",
    });

    // Create retry
    const retryRun = await createRetryRun(runId);
    expect(retryRun.lineageParentRunId).toBe(runId);
    expect(retryRun.status).toBe("queued");
    expect(retryRun.config).toBe("with_skill"); // same config as parent

    // Parent should be superseded
    const parent = await getRun(runId);
    expect(parent?.supersededByRunId).toBe(retryRun.id);
  });

  it("rejects retry on non-failed run", async () => {
    const { runIds } = await seedIterationWithRuns();
    const runId = runIds[0]!;

    // Run is still queued — not failed
    await expect(createRetryRun(runId)).rejects.toThrow(
      "Cannot retry run",
    );
  });

  it("§7.5: failed runs are never overwritten", async () => {
    const { runIds } = await seedIterationWithRuns();
    const runId = runIds[0]!;

    await transitionRunStatus(runId, "provisioning");
    await transitionRunStatus(runId, "provisioning_failed", {
      failureReason: "OOM",
    });

    // Verify the failed run still exists and is unchanged after retry
    await createRetryRun(runId);
    const failedRun = await getRun(runId);
    expect(failedRun?.status).toBe("provisioning_failed");
    expect(failedRun?.failureReason).toBe("OOM");
  });
});
