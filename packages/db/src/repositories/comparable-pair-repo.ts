import { prisma } from "../index.js";
import type { ComparablePair } from "@prisma/client";

/**
 * Update pair status when a run finalizes (§10.6).
 * Checks both runs succeeded, then verifies envelope comparability.
 *
 * §7.2: Pair is benchmark-eligible only if both succeeded + same comparabilityHash
 * + same grader version.
 */
export async function updatePairOnRunFinalized(
  runId: string,
): Promise<ComparablePair | null> {
  // Find the pair that includes this run
  const pair = await prisma.comparablePair.findFirst({
    where: {
      OR: [{ primaryRunId: runId }, { baselineRunId: runId }],
    },
  });

  if (!pair) return null;

  // Load both runs
  const [primaryRun, baselineRun] = await Promise.all([
    prisma.run.findUniqueOrThrow({ where: { id: pair.primaryRunId } }),
    prisma.run.findUniqueOrThrow({ where: { id: pair.baselineRunId } }),
  ]);

  // Check if either run failed
  const failedStatuses = [
    "provisioning_failed",
    "running_failed",
    "timed_out",
    "finalization_failed",
    "canceled",
  ];

  if (failedStatuses.includes(primaryRun.status)) {
    return prisma.comparablePair.update({
      where: { id: pair.id },
      data: { status: "awaiting_comparable_retry" },
    });
  }

  if (failedStatuses.includes(baselineRun.status)) {
    return prisma.comparablePair.update({
      where: { id: pair.id },
      data: { status: "awaiting_comparable_retry" },
    });
  }

  // If both succeeded, check envelope comparability
  if (primaryRun.status === "succeeded" && baselineRun.status === "succeeded") {
    // Load execution envelopes
    const [primaryEnvelope, baselineEnvelope] = await Promise.all([
      prisma.executionEnvelope.findUnique({
        where: { runId: pair.primaryRunId },
      }),
      prisma.executionEnvelope.findUnique({
        where: { runId: pair.baselineRunId },
      }),
    ]);

    if (!primaryEnvelope || !baselineEnvelope) {
      return prisma.comparablePair.update({
        where: { id: pair.id },
        data: {
          status: "excluded",
          exclusionReason: "Missing execution envelope",
        },
      });
    }

    // §9.3: Compare comparability hashes
    if (
      primaryEnvelope.comparabilityHash !== baselineEnvelope.comparabilityHash
    ) {
      return prisma.comparablePair.update({
        where: { id: pair.id },
        data: {
          status: "excluded",
          exclusionReason: `Envelope mismatch: ${primaryEnvelope.comparabilityHash} vs ${baselineEnvelope.comparabilityHash}`,
        },
      });
    }

    // Comparable!
    return prisma.comparablePair.update({
      where: { id: pair.id },
      data: {
        status: "comparable",
        comparabilityHash: primaryEnvelope.comparabilityHash,
      },
    });
  }

  // One or both still in progress — update to awaiting state
  if (primaryRun.status !== "succeeded") {
    return prisma.comparablePair.update({
      where: { id: pair.id },
      data: { status: "awaiting_primary" },
    });
  }

  return prisma.comparablePair.update({
    where: { id: pair.id },
    data: { status: "awaiting_baseline" },
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
  return prisma.comparablePair.update({
    where: { id: pairId },
    data: {
      status: "graded",
      gradedWithGraderVersion: graderVersion,
    },
  });
}

/**
 * Mark a pair as included in benchmark.
 */
export async function markPairInBenchmark(
  pairId: string,
): Promise<ComparablePair> {
  return prisma.comparablePair.update({
    where: { id: pairId },
    data: { status: "included_in_benchmark" },
  });
}
