import { prisma } from "../index.js";
import type { ReviewSession, Review } from "@prisma/client";

/**
 * Create a review session (§8.6: starts "open").
 * §5.2: Only one open review session per iteration.
 */
export async function createReviewSession(
  iterationId: string,
  input: {
    iterationSnapshotHash: string;
    benchmarkHash: string;
  },
): Promise<ReviewSession> {
  return prisma.$transaction(async (tx) => {
    // Check for existing open session (§5.2 — atomic with creation)
    const existingOpen = await tx.reviewSession.findFirst({
      where: { iterationId, status: "open" },
    });
    if (existingOpen) {
      throw new Error(
        `Iteration ${iterationId} already has an open review session: ${existingOpen.id}`,
      );
    }

    return tx.reviewSession.create({
      data: {
        iterationId,
        iterationSnapshotHash: input.iterationSnapshotHash,
        benchmarkHash: input.benchmarkHash,
        status: "open",
      },
    });
  });
}

/**
 * Add a review to a session.
 */
export async function addReview(
  sessionId: string,
  input: {
    runId: string;
    runManifestHash: string;
    feedback: string;
  },
): Promise<Review> {
  const session = await prisma.reviewSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  if (session.status !== "open") {
    throw new Error(`Cannot add reviews to a ${session.status} session`);
  }

  return prisma.review.create({
    data: {
      reviewSessionId: sessionId,
      runId: input.runId,
      runManifestHash: input.runManifestHash,
      feedback: input.feedback,
    },
  });
}

/**
 * Submit a review session (§10.9).
 * Validates session is not stale (§16.2).
 * Validates benchmarkHash matches (§16.1).
 * §1.5: Review is a gate before revision.
 */
export async function submitReviewSession(
  sessionId: string,
  benchmarkHash: string,
  submittedBy: string,
): Promise<ReviewSession> {
  const session = await prisma.reviewSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  if (session.status !== "open") {
    throw new Error(
      `Cannot submit review session in status: ${session.status}`,
    );
  }

  if (session.benchmarkHash !== benchmarkHash) {
    throw new Error(
      `Benchmark hash mismatch: expected ${session.benchmarkHash}, got ${benchmarkHash}. Session may be stale.`,
    );
  }

  // Check for staleness: is there a newer benchmark for this iteration?
  const latestBenchmark = await prisma.benchmark.findFirst({
    where: { iterationId: session.iterationId },
    orderBy: { createdAt: "desc" },
  });
  if (latestBenchmark && latestBenchmark.benchmarkHash !== benchmarkHash) {
    // Mark session as stale
    await prisma.reviewSession.update({
      where: { id: sessionId },
      data: { status: "stale", staleAt: new Date() },
    });
    throw new Error(
      "Review session is stale: a newer benchmark exists for this iteration",
    );
  }

  return prisma.reviewSession.update({
    where: { id: sessionId },
    data: {
      status: "submitted",
      submittedBy,
      submittedAt: new Date(),
    },
  });
}

/**
 * Waive review (§16.3). Records who waived, why, timestamp.
 */
export async function waiveReview(
  sessionId: string,
  input: {
    waivedBy: string;
    waiverReason: string;
  },
): Promise<ReviewSession> {
  const session = await prisma.reviewSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  if (session.status !== "open") {
    throw new Error(
      `Cannot waive review session in status: ${session.status}`,
    );
  }

  return prisma.reviewSession.update({
    where: { id: sessionId },
    data: {
      status: "submitted",
      waivedBy: input.waivedBy,
      waiverReason: input.waiverReason,
      submittedAt: new Date(),
    },
  });
}

/**
 * Get a review session with its reviews.
 */
export async function getReviewSession(
  sessionId: string,
): Promise<(ReviewSession & { reviews: Review[] }) | null> {
  return prisma.reviewSession.findUnique({
    where: { id: sessionId },
    include: { reviews: true },
  });
}
