import { prisma } from "../index.js";
import type { ComparablePair } from "@prisma/client";
import {
  assertValidComparablePairTransition,
  type ComparablePairStatus,
} from "@skillshub/domain";

/**
 * Update pair status when a run finalizes (§10.6).
 * Wrapped in a transaction to prevent race conditions.
 * All transitions validated against §8.4 state machine.
 *
 * §7.2: Pair is benchmark-eligible only if both succeeded + same comparabilityHash
 * + same grader version.
 */
export async function updatePairOnRunFinalized(
  runId: string,
): Promise<ComparablePair | null> {
  return prisma.$transaction(async (tx) => {
    // Find the pair that includes this run
    const pair = await tx.comparablePair.findFirst({
      where: {
        OR: [{ primaryRunId: runId }, { baselineRunId: runId }],
      },
    });

    if (!pair) return null;

    const currentStatus = pair.status as ComparablePairStatus;

    // Load both runs
    const [primaryRun, baselineRun] = await Promise.all([
      tx.run.findUniqueOrThrow({ where: { id: pair.primaryRunId } }),
      tx.run.findUniqueOrThrow({ where: { id: pair.baselineRunId } }),
    ]);

    const failedStatuses = [
      "provisioning_failed",
      "running_failed",
      "timed_out",
      "finalization_failed",
      "canceled",
    ];

    const primaryFailed = failedStatuses.includes(primaryRun.status);
    const baselineFailed = failedStatuses.includes(baselineRun.status);
    const primarySucceeded = primaryRun.status === "succeeded";
    const baselineSucceeded = baselineRun.status === "succeeded";

    // Determine the correct target status based on current state and run statuses
    let targetStatus: ComparablePairStatus;
    let extraData: Record<string, unknown> = {};

    if (primaryFailed || baselineFailed) {
      // A run failed — if we're already in an awaiting state, go to awaiting_comparable_retry;
      // if still pending, go to the appropriate awaiting state first (or excluded)
      if (
        currentStatus === "awaiting_primary" ||
        currentStatus === "awaiting_baseline" ||
        currentStatus === "awaiting_comparable_retry"
      ) {
        targetStatus = "awaiting_comparable_retry";
      } else if (currentStatus === "pending") {
        // From pending, we can't go to awaiting_comparable_retry directly.
        // Go to the correct awaiting state based on which run completed/failed.
        if (runId === pair.primaryRunId) {
          targetStatus = "awaiting_primary";
        } else {
          targetStatus = "awaiting_baseline";
        }
      } else {
        // From other states (comparable, graded, etc.), exclude
        targetStatus = "excluded";
        extraData = { exclusionReason: "Run failed after pair was already progressed" };
      }
    } else if (primarySucceeded && baselineSucceeded) {
      // Both succeeded — check envelope comparability
      const [primaryEnvelope, baselineEnvelope] = await Promise.all([
        tx.executionEnvelope.findUnique({ where: { runId: pair.primaryRunId } }),
        tx.executionEnvelope.findUnique({ where: { runId: pair.baselineRunId } }),
      ]);

      if (!primaryEnvelope || !baselineEnvelope) {
        targetStatus = "excluded";
        extraData = { exclusionReason: "Missing execution envelope" };
      } else if (primaryEnvelope.comparabilityHash !== baselineEnvelope.comparabilityHash) {
        // §9.3: Different comparability hashes
        targetStatus = "excluded";
        extraData = {
          exclusionReason: `Envelope mismatch: ${primaryEnvelope.comparabilityHash} vs ${baselineEnvelope.comparabilityHash}`,
        };
      } else {
        // Comparable! Need to get to comparable state via valid transitions.
        // From pending → awaiting_primary/baseline → comparable
        // From awaiting_* → comparable
        if (currentStatus === "pending") {
          // Transition through awaiting state first, then to comparable
          const intermediateStatus: ComparablePairStatus =
            runId === pair.primaryRunId ? "awaiting_baseline" : "awaiting_primary";
          assertValidComparablePairTransition(currentStatus, intermediateStatus);
          await tx.comparablePair.update({
            where: { id: pair.id },
            data: { status: intermediateStatus },
          });
          // Now transition to comparable
          assertValidComparablePairTransition(intermediateStatus, "comparable");
          return tx.comparablePair.update({
            where: { id: pair.id },
            data: {
              status: "comparable",
              comparabilityHash: primaryEnvelope.comparabilityHash,
            },
          });
        }
        targetStatus = "comparable";
        extraData = { comparabilityHash: primaryEnvelope.comparabilityHash };
      }
    } else {
      // One run still in progress — update to the correct awaiting state
      if (!primarySucceeded && !primaryFailed) {
        targetStatus = "awaiting_primary";
      } else {
        targetStatus = "awaiting_baseline";
      }
    }

    // Skip if already in the target state
    if (currentStatus === targetStatus) {
      return pair;
    }

    // Validate the transition against §8.4 state machine
    assertValidComparablePairTransition(currentStatus, targetStatus);

    return tx.comparablePair.update({
      where: { id: pair.id },
      data: { status: targetStatus, ...extraData },
    });
  });
}

/**
 * Get all comparable pairs for an iteration.
 */
export async function getPairsForIteration(
  iterationId: string,
): Promise<ComparablePair[]> {
  return prisma.comparablePair.findMany({
    where: { iterationId },
    orderBy: { evalSnapshotId: "asc" },
  });
}

/**
 * Mark a pair as graded after both runs have been graded.
 */
export async function markPairGraded(
  pairId: string,
  graderVersion: string,
): Promise<ComparablePair> {
  return prisma.$transaction(async (tx) => {
    const pair = await tx.comparablePair.findUniqueOrThrow({ where: { id: pairId } });
    assertValidComparablePairTransition(pair.status as ComparablePairStatus, "graded");
    return tx.comparablePair.update({
      where: { id: pairId },
      data: {
        status: "graded",
        gradedWithGraderVersion: graderVersion,
      },
    });
  });
}

/**
 * Mark a pair as included in benchmark.
 */
export async function markPairInBenchmark(
  pairId: string,
): Promise<ComparablePair> {
  return prisma.$transaction(async (tx) => {
    const pair = await tx.comparablePair.findUniqueOrThrow({ where: { id: pairId } });
    assertValidComparablePairTransition(pair.status as ComparablePairStatus, "included_in_benchmark");
    return tx.comparablePair.update({
      where: { id: pairId },
      data: { status: "included_in_benchmark" },
    });
  });
}
