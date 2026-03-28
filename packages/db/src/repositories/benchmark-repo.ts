import { prisma } from "../index.js";
import type { Benchmark, Grade } from "@prisma/client";

/**
 * Create a benchmark for an iteration.
 */
export async function createBenchmark(input: {
  iterationId: string;
  benchmarkJson: string;
  benchmarkHash: string;
  benchmarkMdUri?: string;
  analystNotesJson?: string;
}): Promise<Benchmark> {
  return prisma.benchmark.create({
    data: {
      iterationId: input.iterationId,
      benchmarkJson: input.benchmarkJson,
      benchmarkHash: input.benchmarkHash,
      benchmarkMdUri: input.benchmarkMdUri ?? null,
      analystNotesJson: input.analystNotesJson ?? "{}",
    },
  });
}

/**
 * Create a grade for a run.
 */
export async function createGrade(input: {
  runId: string;
  graderVersion: string;
  assertionSnapshotHash: string;
  gradingJson: string;
}): Promise<Grade> {
  return prisma.grade.create({
    data: {
      runId: input.runId,
      graderVersion: input.graderVersion,
      assertionSnapshotHash: input.assertionSnapshotHash,
      gradingJson: input.gradingJson,
    },
  });
}

/**
 * Get the latest benchmark for an iteration.
 */
export async function getLatestBenchmark(
  iterationId: string,
): Promise<Benchmark | null> {
  return prisma.benchmark.findFirst({
    where: { iterationId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get all grades for a run.
 */
export async function getGradesForRun(runId: string): Promise<Grade[]> {
  return prisma.grade.findMany({
    where: { runId },
    orderBy: { completedAt: "desc" },
  });
}
