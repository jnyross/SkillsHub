import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createProject } from "../repositories/project-repo.js";
import { createSkill, createDraftVersion, freezeVersion } from "../repositories/skill-repo.js";
import { createEvalSet, addEvalCase, addAssertion, freezeEvalSet } from "../repositories/eval-repo.js";
import { createIteration, getIteration } from "../repositories/iteration-repo.js";

// Use a direct client for cleanup only
const cleanupClient = new PrismaClient();

beforeAll(async () => {
  await cleanupClient.$connect();
});

afterAll(async () => {
  await cleanupClient.$disconnect();
});

beforeEach(async () => {
  // Clean all tables before each test (order matters for foreign keys)
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

async function seedProjectAndSkill() {
  const project = await createProject({
    name: "Test Project",
    slug: `test-${Date.now()}`,
    ownerUserId: "user-1",
  });

  const skill = await createSkill({
    projectId: project.id,
    name: "Test Skill",
    slug: "test-skill",
  });

  const version = await createDraftVersion(skill.id, {
    frontmatterName: "Test Skill",
    frontmatterDescription: "A test skill",
    createdBy: "user-1",
  });

  const frozenVersion = await freezeVersion(version.id);

  return { project, skill, version: frozenVersion };
}

async function seedEvalSet(projectId: string, caseCount = 3) {
  const evalSet = await createEvalSet({ projectId, name: "Test Eval Set" });

  for (let i = 0; i < caseCount; i++) {
    const evalCase = await addEvalCase(evalSet.id, {
      slug: `case-${i + 1}`,
      prompt: `Test prompt ${i + 1}`,
      expectedOutput: `Expected output ${i + 1}`,
    });

    await addAssertion(evalCase.id, {
      text: `Output contains greeting ${i + 1}`,
      type: "text_contains",
      configJson: JSON.stringify({ substring: "hello" }),
    });
  }

  const frozen = await freezeEvalSet(evalSet.id);
  return frozen;
}

describe("createIteration (§10.4 — full transaction)", () => {
  it("creates iteration with correct number of snapshots, runs, and pairs", async () => {
    const { project, version } = await seedProjectAndSkill();
    const evalSet = await seedEvalSet(project.id, 3);

    const result = await createIteration({
      projectId: project.id,
      skillVersionId: version.id,
      evalSetId: evalSet.id,
      baselineMode: "without_skill",
      modelConfigJson: JSON.stringify({ backend: "claude-code", modelId: "claude-sonnet-4-20250514" }),
      toolConfigJson: JSON.stringify({ allowFileIO: true, allowNetwork: false }),
    });

    // 3 cases → 3 snapshots
    expect(result.snapshots).toHaveLength(3);
    // 3 cases × 2 runs (with_skill + without_skill) = 6 runs
    expect(result.runIds).toHaveLength(6);
    // Iteration starts in "drafting"
    expect(result.iteration.status).toBe("drafting");
    expect(result.iteration.number).toBe(1);
    expect(result.iteration.launchBatchId).toBeTruthy();

    // Verify snapshots have correct hashes
    for (const snap of result.snapshots) {
      expect(snap.snapshotHash).toBeTruthy();
      expect(snap.promptSnapshot).toBeTruthy();
    }

    // Verify runs are queued with correct config
    const iteration = await getIteration(result.iteration.id);
    expect(iteration).not.toBeNull();
    const runs = iteration!.runs;
    expect(runs).toHaveLength(6);

    const withSkillRuns = runs.filter((r) => r.config === "with_skill");
    const baselineRuns = runs.filter((r) => r.config === "without_skill");
    expect(withSkillRuns).toHaveLength(3);
    expect(baselineRuns).toHaveLength(3);

    // All runs should be queued
    for (const run of runs) {
      expect(run.status).toBe("queued");
    }

    // Verify comparable pairs
    const pairs = await cleanupClient.comparablePair.findMany({
      where: { iterationId: result.iteration.id },
    });
    expect(pairs).toHaveLength(3);
    for (const pair of pairs) {
      expect(pair.status).toBe("pending");
      expect(pair.primaryRunId).toBeTruthy();
      expect(pair.baselineRunId).toBeTruthy();
    }
  });

  it("rejects iteration with unfrozen skill version", async () => {
    const project = await createProject({
      name: "Test Project",
      slug: `test-${Date.now()}`,
      ownerUserId: "user-1",
    });
    const skill = await createSkill({
      projectId: project.id,
      name: "Test Skill",
      slug: "test-skill",
    });
    const draftVersion = await createDraftVersion(skill.id, {
      frontmatterName: "Test",
      frontmatterDescription: "Test",
      createdBy: "user-1",
    });
    const evalSet = await seedEvalSet(project.id, 1);

    await expect(
      createIteration({
        projectId: project.id,
        skillVersionId: draftVersion.id,
        evalSetId: evalSet.id,
        baselineMode: "without_skill",
        modelConfigJson: "{}",
        toolConfigJson: "{}",
      }),
    ).rejects.toThrow("must be frozen or accepted");
  });

  it("rejects iteration with unfrozen eval set", async () => {
    const { project, version } = await seedProjectAndSkill();

    // Create eval set but don't freeze it
    const evalSet = await createEvalSet({ projectId: project.id, name: "Unfrozen" });
    await addEvalCase(evalSet.id, { slug: "case-1", prompt: "test" });

    await expect(
      createIteration({
        projectId: project.id,
        skillVersionId: version.id,
        evalSetId: evalSet.id,
        baselineMode: "without_skill",
        modelConfigJson: "{}",
        toolConfigJson: "{}",
      }),
    ).rejects.toThrow("must be frozen");
  });

  it("rejects iteration with empty eval set", async () => {
    const { project, version } = await seedProjectAndSkill();
    const evalSet = await createEvalSet({ projectId: project.id, name: "Empty" });
    const frozen = await freezeEvalSet(evalSet.id);

    await expect(
      createIteration({
        projectId: project.id,
        skillVersionId: version.id,
        evalSetId: frozen.id,
        baselineMode: "without_skill",
        modelConfigJson: "{}",
        toolConfigJson: "{}",
      }),
    ).rejects.toThrow("has no cases");
  });

  it("increments iteration number correctly", async () => {
    const { project, version } = await seedProjectAndSkill();
    const evalSet = await seedEvalSet(project.id, 1);

    const first = await createIteration({
      projectId: project.id,
      skillVersionId: version.id,
      evalSetId: evalSet.id,
      baselineMode: "without_skill",
      modelConfigJson: "{}",
      toolConfigJson: "{}",
    });
    expect(first.iteration.number).toBe(1);

    const second = await createIteration({
      projectId: project.id,
      skillVersionId: version.id,
      evalSetId: evalSet.id,
      baselineMode: "without_skill",
      modelConfigJson: "{}",
      toolConfigJson: "{}",
    });
    expect(second.iteration.number).toBe(2);
  });
});
