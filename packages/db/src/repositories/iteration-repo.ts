import { createHash } from "node:crypto";
import { prisma } from "../index.js";
import type { Iteration, Run, IterationEvalSnapshot } from "@prisma/client";
import {
  assertValidIterationTransition,
  type IterationStatus,
} from "@skillshub/domain";

/**
 * Create an iteration with snapshots, paired runs, and comparable pairs.
 * Single transaction (§5.3) performing:
 *  1. Verify skill version is frozen (§1.1)
 *  2. Verify eval set is frozen (§1.1)
 *  3. Create Iteration row
 *  4. For each EvalCase → create IterationEvalSnapshot (§4.10)
 *  5. For each snapshot → create paired Runs (with_skill + baseline) (§1.2)
 *  6. For each snapshot → create ComparablePair row (§4.16)
 */
export async function createIteration(input: {
  projectId: string;
  skillVersionId: string;
  baselineSkillVersionId?: string;
  evalSetId: string;
  baselineMode: "without_skill" | "old_skill";
  modelConfigJson: string;
  toolConfigJson: string;
  budgetSnapshotJson?: string;
}): Promise<{
  iteration: Iteration;
  snapshots: IterationEvalSnapshot[];
  runIds: string[];
}> {
  return prisma.$transaction(async (tx) => {
    // 1. Verify skill version is frozen
    const skillVersion = await tx.skillVersion.findUniqueOrThrow({
      where: { id: input.skillVersionId },
    });
    if (skillVersion.status !== "frozen" && skillVersion.status !== "accepted") {
      throw new Error(
        `Skill version ${input.skillVersionId} must be frozen or accepted to start an iteration, got: ${skillVersion.status}`,
      );
    }

    // 2. Verify eval set is frozen
    const evalSet = await tx.evalSet.findUniqueOrThrow({
      where: { id: input.evalSetId },
      include: { cases: { include: { assertions: true } } },
    });
    if (evalSet.status !== "frozen") {
      throw new Error(
        `Eval set ${input.evalSetId} must be frozen to start an iteration, got: ${evalSet.status}`,
      );
    }

    if (evalSet.cases.length === 0) {
      throw new Error(
        `Eval set ${input.evalSetId} has no cases — cannot create iteration`,
      );
    }

    // If old_skill mode, verify baseline skill version exists and is frozen/accepted
    if (input.baselineMode === "old_skill") {
      if (!input.baselineSkillVersionId) {
        throw new Error(
          "baselineSkillVersionId is required for old_skill mode",
        );
      }
      const baselineVersion = await tx.skillVersion.findUniqueOrThrow({
        where: { id: input.baselineSkillVersionId },
      });
      if (
        baselineVersion.status !== "frozen" &&
        baselineVersion.status !== "accepted"
      ) {
        throw new Error(
          `Baseline skill version ${input.baselineSkillVersionId} must be frozen or accepted, got: ${baselineVersion.status}`,
        );
      }
    }

    // 3. Get next iteration number for this project
    const latestIteration = await tx.iteration.findFirst({
      where: { projectId: input.projectId },
      orderBy: { number: "desc" },
    });
    const nextNumber = (latestIteration?.number ?? 0) + 1;

    // Compute snapshot hash from all eval case data
    const snapshotData = evalSet.cases.map((c) => ({
      slug: c.slug,
      prompt: c.prompt,
      expectedOutput: c.expectedOutput,
      filesManifestJson: c.filesManifestJson,
      assertions: c.assertions.map((a) => ({
        text: a.text,
        type: a.type,
        configJson: a.configJson,
      })),
    }));
    const snapshotHash = createHash("sha256")
      .update(JSON.stringify(snapshotData))
      .digest("hex");

    const batchId = createHash("sha256")
      .update(`${input.projectId}-${nextNumber}-${Date.now()}`)
      .digest("hex")
      .slice(0, 16);

    // 4. Create iteration
    const iteration = await tx.iteration.create({
      data: {
        projectId: input.projectId,
        number: nextNumber,
        skillVersionId: input.skillVersionId,
        baselineSkillVersionId: input.baselineSkillVersionId ?? null,
        evalSetId: input.evalSetId,
        snapshotHash,
        modelConfigJson: input.modelConfigJson,
        toolConfigJson: input.toolConfigJson,
        budgetSnapshotJson: input.budgetSnapshotJson ?? "{}",
        reviewGateStatus: "locked",
        launchBatchId: batchId,
        status: "drafting",
      },
    });

    const snapshots: IterationEvalSnapshot[] = [];
    const runIds: string[] = [];

    // 5. For each eval case, create snapshot + paired runs + comparable pair
    for (const evalCase of evalSet.cases) {
      const caseSnapshotData = {
        prompt: evalCase.prompt,
        expectedOutput: evalCase.expectedOutput,
        filesManifestJson: evalCase.filesManifestJson,
        assertions: evalCase.assertions.map((a) => ({
          text: a.text,
          type: a.type,
          configJson: a.configJson,
          isQuantitative: a.isQuantitative,
        })),
      };
      const caseSnapshotHash = createHash("sha256")
        .update(JSON.stringify(caseSnapshotData))
        .digest("hex");

      const snapshot = await tx.iterationEvalSnapshot.create({
        data: {
          iterationId: iteration.id,
          evalCaseId: evalCase.id,
          promptSnapshot: evalCase.prompt,
          expectedOutputSnapshot: evalCase.expectedOutput,
          filesManifestSnapshotJson: evalCase.filesManifestJson,
          assertionsSnapshotJson: JSON.stringify(
            evalCase.assertions.map((a) => ({
              text: a.text,
              type: a.type,
              configJson: a.configJson,
              isQuantitative: a.isQuantitative,
            })),
          ),
          snapshotHash: caseSnapshotHash,
        },
      });
      snapshots.push(snapshot);

      const attemptGroup = createHash("sha256")
        .update(`${iteration.id}-${snapshot.id}-${Date.now()}`)
        .digest("hex")
        .slice(0, 16);

      // Create primary run (with_skill)
      const primaryRun = await tx.run.create({
        data: {
          iterationId: iteration.id,
          evalSnapshotId: snapshot.id,
          config: "with_skill",
          status: "queued",
          comparableAttemptGroup: attemptGroup,
        },
      });
      runIds.push(primaryRun.id);

      // Create baseline run (without_skill or old_skill)
      const baselineRun = await tx.run.create({
        data: {
          iterationId: iteration.id,
          evalSnapshotId: snapshot.id,
          config: input.baselineMode,
          status: "queued",
          comparableAttemptGroup: attemptGroup,
        },
      });
      runIds.push(baselineRun.id);

      // Create comparable pair
      await tx.comparablePair.create({
        data: {
          iterationId: iteration.id,
          evalSnapshotId: snapshot.id,
          primaryRunId: primaryRun.id,
          baselineRunId: baselineRun.id,
          comparabilityHash: "",  // Will be computed when envelopes are created
          status: "pending",
        },
      });
    }

    return { iteration, snapshots, runIds };
  });
}

/**
 * Transition iteration status. Enforces §8.5 state machine.
 */
export async function transitionIterationStatus(
  iterationId: string,
  to: IterationStatus,
): Promise<Iteration> {
  const iteration = await prisma.iteration.findUniqueOrThrow({
    where: { id: iterationId },
  });

  assertValidIterationTransition(iteration.status as IterationStatus, to);

  const data: Record<string, unknown> = { status: to };
  if (to === "running" || to === "queued") {
    if (!iteration.startedAt) {
      data["startedAt"] = new Date();
    }
  }
  if (to === "completed" || to === "failed" || to === "canceled") {
    data["completedAt"] = new Date();
  }

  return prisma.iteration.update({
    where: { id: iterationId },
    data,
  });
}

/**
 * Get an iteration with full details.
 */
export async function getIteration(iterationId: string): Promise<
  | (Iteration & {
      evalSnapshots: IterationEvalSnapshot[];
      runs: Run[];
    })
  | null
> {
  return prisma.iteration.findUnique({
    where: { id: iterationId },
    include: {
      evalSnapshots: true,
      runs: { orderBy: { createdAt: "asc" } },
    },
  });
}
