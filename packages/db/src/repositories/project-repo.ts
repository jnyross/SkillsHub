import { prisma } from "../index.js";
import type { Project, ProjectBrief, Prisma } from "@prisma/client";

/**
 * Create a project and its first empty brief (§10.1).
 * Transitions project to "draft" by default.
 */
export async function createProject(input: {
  name: string;
  slug: string;
  ownerUserId: string;
}): Promise<Project & { briefs: ProjectBrief[] }> {
  return prisma.project.create({
    data: {
      name: input.name,
      slug: input.slug,
      ownerUserId: input.ownerUserId,
      status: "draft",
      briefs: {
        create: [{ sourcePrompt: "", problemStatement: "", targetUser: "" }],
      },
    },
    include: { briefs: true },
  });
}

/**
 * Get a project by ID with its briefs.
 */
export async function getProject(
  projectId: string,
): Promise<(Project & { briefs: ProjectBrief[] }) | null> {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: { briefs: true },
  });
}

/**
 * Update a discovery brief's content.
 */
export async function updateBrief(
  briefId: string,
  data: Partial<
    Pick<
      ProjectBrief,
      | "sourcePrompt"
      | "problemStatement"
      | "targetUser"
      | "successCriteriaJson"
      | "constraintsJson"
      | "assumptionsJson"
      | "openQuestionsJson"
    >
  >,
): Promise<ProjectBrief> {
  return prisma.projectBrief.update({
    where: { id: briefId },
    data,
  });
}

/**
 * Approve a discovery brief (§10.1).
 * Sets approvedAt and transitions the parent project to "active".
 */
export async function approveBrief(briefId: string): Promise<ProjectBrief> {
  return prisma.$transaction(async (tx) => {
    const brief = await tx.projectBrief.update({
      where: { id: briefId },
      data: { approvedAt: new Date() },
    });

    await tx.project.update({
      where: { id: brief.projectId },
      data: { status: "active" },
    });

    return brief;
  });
}
