import { prisma } from "../index.js";
import type { EvalSet, EvalCase, Assertion } from "@prisma/client";
import {
  assertValidEvalSetTransition,
  type EvalSetStatus,
} from "@skillshub/domain";

/**
 * Create a new eval set under a project.
 */
export async function createEvalSet(input: {
  projectId: string;
  name: string;
}): Promise<EvalSet> {
  return prisma.evalSet.create({
    data: { projectId: input.projectId, name: input.name, status: "draft" },
  });
}

/**
 * Get an eval set by ID with its cases and assertions.
 */
export async function getEvalSet(
  evalSetId: string,
): Promise<
  (EvalSet & { cases: (EvalCase & { assertions: Assertion[] })[] }) | null
> {
  return prisma.evalSet.findUnique({
    where: { id: evalSetId },
    include: { cases: { include: { assertions: true } } },
  });
}

/**
 * Add an eval case to a draft eval set.
 */
export async function addEvalCase(
  evalSetId: string,
  input: {
    slug: string;
    prompt: string;
    expectedOutput?: string;
    filesManifestJson?: string;
  },
): Promise<EvalCase> {
  const evalSet = await prisma.evalSet.findUniqueOrThrow({
    where: { id: evalSetId },
  });
  if (evalSet.status !== "draft") {
    throw new Error(`Cannot add cases to a ${evalSet.status} eval set`);
  }

  return prisma.evalCase.create({
    data: {
      evalSetId,
      slug: input.slug,
      prompt: input.prompt,
      expectedOutput: input.expectedOutput ?? "",
      filesManifestJson: input.filesManifestJson ?? "[]",
    },
  });
}

/**
 * Add an assertion to an eval case.
 */
export async function addAssertion(
  evalCaseId: string,
  input: {
    text: string;
    type: string;
    configJson?: string;
    isQuantitative?: boolean;
    createdBy?: string;
  },
): Promise<Assertion> {
  // Verify the eval case's eval set is still draft
  const evalCase = await prisma.evalCase.findUniqueOrThrow({
    where: { id: evalCaseId },
    include: { evalSet: true },
  });
  if (evalCase.evalSet.status !== "draft") {
    throw new Error(
      `Cannot add assertions to a ${evalCase.evalSet.status} eval set`,
    );
  }

  return prisma.assertion.create({
    data: {
      evalCaseId,
      text: input.text,
      type: input.type,
      configJson: input.configJson ?? "{}",
      isQuantitative: input.isQuantitative ?? false,
      createdBy: input.createdBy ?? "",
    },
  });
}

/**
 * Freeze an eval set (§8.2: draft → frozen).
 * §1.1: frozen eval sets are immutable.
 */
export async function freezeEvalSet(evalSetId: string): Promise<EvalSet> {
  const evalSet = await prisma.evalSet.findUniqueOrThrow({
    where: { id: evalSetId },
  });

  assertValidEvalSetTransition(evalSet.status as EvalSetStatus, "frozen");

  return prisma.evalSet.update({
    where: { id: evalSetId },
    data: { status: "frozen" },
  });
}
