import { prisma } from "../index.js";
import type { Run, RunMetrics } from "@prisma/client";
import { assertValidRunTransition, type RunStatus } from "@skillshub/domain";

/**
 * Transition run status. Enforces §8.3 state machine.
 */
export async function transitionRunStatus(
  runId: string,
  to: RunStatus,
  extra?: { failureReason?: string; sandboxId?: string },
): Promise<Run> {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });

  assertValidRunTransition(run.status as RunStatus, to);

  const data: Record<string, unknown> = { status: to };

  // Set timestamps for specific transitions
  if (to === "provisioning" || to === "running") {
    if (!run.startedAt) {
      data["startedAt"] = new Date();
    }
  }
  if (to === "result_received") {
    data["resultReceivedAt"] = new Date();
  }
  if (to === "succeeded" || to === "finalization_failed") {
    data["finalizedAt"] = new Date();
  }
  if (
    to === "succeeded" ||
    to === "provisioning_failed" ||
    to === "running_failed" ||
    to === "timed_out" ||
    to === "finalization_failed" ||
    to === "canceled"
  ) {
    data["completedAt"] = new Date();
  }

  if (extra?.failureReason) {
    data["failureReason"] = extra.failureReason;
  }
  if (extra?.sandboxId) {
    data["sandboxId"] = extra.sandboxId;
  }

  return prisma.run.update({ where: { id: runId }, data });
}

/**
 * Persist timing metrics immediately on run completion (§1.3).
 */
export async function persistRunMetrics(
  runId: string,
  metrics: {
    totalTokens: number;
    durationMs: number;
    totalCostUsd: number | null;
  },
): Promise<RunMetrics> {
  return prisma.runMetrics.create({
    data: {
      runId,
      totalTokens: metrics.totalTokens,
      durationMs: metrics.durationMs,
      totalCostUsd: metrics.totalCostUsd,
    },
  });
}

/**
 * Create a retry run (§17.1: new row, linked to parent via lineageParentRunId).
 * §17.2: New run must match original comparabilityHash to be benchmark-eligible.
 * §7.5: Never overwrite or delete failed runs.
 */
export async function createRetryRun(parentRunId: string): Promise<Run> {
  return prisma.$transaction(async (tx) => {
    const parent = await tx.run.findUniqueOrThrow({
      where: { id: parentRunId },
    });

    // Can only retry failed runs
    const failureStatuses: RunStatus[] = [
      "provisioning_failed",
      "running_failed",
      "timed_out",
      "finalization_failed",
    ];
    if (!failureStatuses.includes(parent.status as RunStatus)) {
      throw new Error(
        `Cannot retry run ${parentRunId} in status ${parent.status}`,
      );
    }

    // Create new run linked to parent
    const retryRun = await tx.run.create({
      data: {
        iterationId: parent.iterationId,
        evalSnapshotId: parent.evalSnapshotId,
        config: parent.config,
        status: "queued",
        lineageParentRunId: parent.id,
        comparableAttemptGroup: parent.comparableAttemptGroup,
      },
    });

    // Mark parent as superseded
    await tx.run.update({
      where: { id: parentRunId },
      data: { supersededByRunId: retryRun.id },
    });

    return retryRun;
  });
}

/**
 * Get a run by ID with metrics and grades.
 */
export async function getRun(runId: string): Promise<
  | (Run & {
      metrics: RunMetrics | null;
    })
  | null
> {
  return prisma.run.findUnique({
    where: { id: runId },
    include: { metrics: true },
  });
}
