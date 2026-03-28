import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createProject } from "../repositories/project-repo.js";
import { createSkill, createDraftVersion, freezeVersion } from "../repositories/skill-repo.js";
import { createEvalSet, addEvalCase, addAssertion, freezeEvalSet } from "../repositories/eval-repo.js";
import { createIteration } from "../repositories/iteration-repo.js";
import {
  createReviewSession,
  submitReviewSession,
  waiveReview,
  addReview,
  getReviewSession,
} from "../repositories/review-repo.js";
import { createBenchmark } from "../repositories/benchmark-repo.js";
import { logAuditEvent, getAuditEvents } from "../repositories/audit-repo.js";

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

async function seedIterationWithBenchmark() {
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
    prompt: "test",
  });
  await addAssertion(evalCase.id, { text: "exists", type: "file_exists" });
  const frozenEvals = await freezeEvalSet(evalSet.id);

  const result = await createIteration({
    projectId: project.id,
    skillVersionId: frozen.id,
    evalSetId: frozenEvals.id,
    baselineMode: "without_skill",
    modelConfigJson: "{}",
    toolConfigJson: "{}",
  });

  const benchmark = await createBenchmark({
    iterationId: result.iteration.id,
    benchmarkJson: JSON.stringify({ passRate: 0.85 }),
    benchmarkHash: "bench-hash-1",
  });

  return { project, skill, iteration: result.iteration, benchmark, runIds: result.runIds };
}

describe("ReviewSession lifecycle (§8.6, §1.5)", () => {
  it("creates a review session and opens it", async () => {
    const { iteration, benchmark } = await seedIterationWithBenchmark();

    const session = await createReviewSession(iteration.id, {
      iterationSnapshotHash: iteration.snapshotHash,
      benchmarkHash: benchmark.benchmarkHash,
    });

    expect(session.status).toBe("open");
    expect(session.iterationId).toBe(iteration.id);
    expect(session.benchmarkHash).toBe("bench-hash-1");
  });

  it("§5.2: rejects second open session for same iteration", async () => {
    const { iteration, benchmark } = await seedIterationWithBenchmark();

    await createReviewSession(iteration.id, {
      iterationSnapshotHash: iteration.snapshotHash,
      benchmarkHash: benchmark.benchmarkHash,
    });

    await expect(
      createReviewSession(iteration.id, {
        iterationSnapshotHash: iteration.snapshotHash,
        benchmarkHash: benchmark.benchmarkHash,
      }),
    ).rejects.toThrow("already has an open review session");
  });

  it("submits a review session with matching benchmark hash", async () => {
    const { iteration, benchmark } = await seedIterationWithBenchmark();

    const session = await createReviewSession(iteration.id, {
      iterationSnapshotHash: iteration.snapshotHash,
      benchmarkHash: benchmark.benchmarkHash,
    });

    const submitted = await submitReviewSession(
      session.id,
      benchmark.benchmarkHash,
      "user-1",
    );

    expect(submitted.status).toBe("submitted");
    expect(submitted.submittedBy).toBe("user-1");
    expect(submitted.submittedAt).toBeTruthy();
  });

  it("rejects submission with mismatched benchmark hash", async () => {
    const { iteration, benchmark } = await seedIterationWithBenchmark();

    const session = await createReviewSession(iteration.id, {
      iterationSnapshotHash: iteration.snapshotHash,
      benchmarkHash: benchmark.benchmarkHash,
    });

    await expect(
      submitReviewSession(session.id, "wrong-hash", "user-1"),
    ).rejects.toThrow("Benchmark hash mismatch");
  });

  it("detects staleness when newer benchmark exists", async () => {
    const { iteration, benchmark } = await seedIterationWithBenchmark();

    const session = await createReviewSession(iteration.id, {
      iterationSnapshotHash: iteration.snapshotHash,
      benchmarkHash: benchmark.benchmarkHash,
    });

    // Create a newer benchmark with a different hash
    await createBenchmark({
      iterationId: iteration.id,
      benchmarkJson: JSON.stringify({ passRate: 0.90 }),
      benchmarkHash: "bench-hash-2",
    });

    // Trying to submit with the original hash should detect staleness
    await expect(
      submitReviewSession(session.id, benchmark.benchmarkHash, "user-1"),
    ).rejects.toThrow("stale");

    // Verify session is now stale
    const staleSession = await getReviewSession(session.id);
    expect(staleSession?.status).toBe("stale");
    expect(staleSession?.staleAt).toBeTruthy();
  });

  it("waives review with reason and actor", async () => {
    const { iteration, benchmark } = await seedIterationWithBenchmark();

    const session = await createReviewSession(iteration.id, {
      iterationSnapshotHash: iteration.snapshotHash,
      benchmarkHash: benchmark.benchmarkHash,
    });

    const waived = await waiveReview(session.id, {
      waivedBy: "admin-1",
      waiverReason: "Quick iteration, will review next cycle",
    });

    expect(waived.status).toBe("submitted");
    expect(waived.waivedBy).toBe("admin-1");
    expect(waived.waiverReason).toBe("Quick iteration, will review next cycle");
  });

  it("adds reviews to an open session", async () => {
    const { iteration, benchmark, runIds } = await seedIterationWithBenchmark();

    const session = await createReviewSession(iteration.id, {
      iterationSnapshotHash: iteration.snapshotHash,
      benchmarkHash: benchmark.benchmarkHash,
    });

    const review = await addReview(session.id, {
      runId: runIds[0]!,
      runManifestHash: "manifest-hash-1",
      feedback: "Good output quality",
    });

    expect(review.reviewSessionId).toBe(session.id);
    expect(review.feedback).toBe("Good output quality");

    const loaded = await getReviewSession(session.id);
    expect(loaded?.reviews).toHaveLength(1);
  });

  it("rejects adding reviews to a submitted session", async () => {
    const { iteration, benchmark, runIds } = await seedIterationWithBenchmark();

    const session = await createReviewSession(iteration.id, {
      iterationSnapshotHash: iteration.snapshotHash,
      benchmarkHash: benchmark.benchmarkHash,
    });

    await submitReviewSession(session.id, benchmark.benchmarkHash, "user-1");

    await expect(
      addReview(session.id, {
        runId: runIds[0]!,
        runManifestHash: "manifest-hash-1",
        feedback: "Late feedback",
      }),
    ).rejects.toThrow("Cannot add reviews to a submitted session");
  });
});

describe("AuditEvent logging (§24.3)", () => {
  it("logs and retrieves audit events", async () => {
    const event = await logAuditEvent({
      entityType: "SkillVersion",
      entityId: "sv-123",
      eventType: "frozen",
      actorUserId: "user-1",
      payload: { from: "draft", to: "frozen" },
    });

    expect(event.entityType).toBe("SkillVersion");
    expect(event.eventType).toBe("frozen");
    expect(event.actorUserId).toBe("user-1");

    const events = await getAuditEvents({
      entityType: "SkillVersion",
      entityId: "sv-123",
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("frozen");
  });
});
