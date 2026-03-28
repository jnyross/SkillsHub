import { prisma } from "../index.js";
import type { Skill, SkillVersion, SkillFile } from "@prisma/client";
import {
  assertValidSkillVersionTransition,
  type SkillVersionStatus,
} from "@skillshub/domain";

/**
 * Create a new skill under a project.
 */
export async function createSkill(input: {
  projectId: string;
  name: string;
  slug: string;
}): Promise<Skill> {
  return prisma.skill.create({ data: input });
}

/**
 * Get a skill by ID with its versions.
 */
export async function getSkill(
  skillId: string,
): Promise<(Skill & { versions: SkillVersion[] }) | null> {
  return prisma.skill.findUnique({
    where: { id: skillId },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
}

/**
 * Create a new draft skill version (§8.1: starts in "draft").
 * §5.2: one active draft per skill — rejects if another draft exists.
 */
export async function createDraftVersion(
  skillId: string,
  input: {
    baseVersionId?: string;
    frontmatterName: string;
    frontmatterDescription: string;
    createdBy: string;
  },
): Promise<SkillVersion> {
  return prisma.$transaction(async (tx) => {
    // Check for existing draft (§5.2)
    const existingDraft = await tx.skillVersion.findFirst({
      where: { skillId, status: "draft" },
    });
    if (existingDraft) {
      throw new Error(
        `Skill ${skillId} already has an active draft version: ${existingDraft.id}`,
      );
    }

    // Determine next version number
    const latestVersion = await tx.skillVersion.findFirst({
      where: { skillId },
      orderBy: { versionNumber: "desc" },
    });
    const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

    const version = await tx.skillVersion.create({
      data: {
        skillId,
        versionNumber: nextVersionNumber,
        status: "draft",
        baseVersionId: input.baseVersionId ?? null,
        frontmatterName: input.frontmatterName,
        frontmatterDescription: input.frontmatterDescription,
        createdBy: input.createdBy,
      },
    });

    // Update skill's currentDraftVersionId
    await tx.skill.update({
      where: { id: skillId },
      data: { currentDraftVersionId: version.id },
    });

    return version;
  });
}

/**
 * Freeze a skill version (§8.1: draft → frozen).
 * Iteration launch requires frozen (§1.1).
 */
export async function freezeVersion(versionId: string): Promise<SkillVersion> {
  return prisma.$transaction(async (tx) => {
    const version = await tx.skillVersion.findUniqueOrThrow({
      where: { id: versionId },
    });

    assertValidSkillVersionTransition(
      version.status as SkillVersionStatus,
      "frozen",
    );

    const updated = await tx.skillVersion.update({
      where: { id: versionId },
      data: { status: "frozen" },
    });

    // Clear currentDraftVersionId since it's no longer a draft
    await tx.skill.update({
      where: { id: version.skillId },
      data: { currentDraftVersionId: null },
    });

    return updated;
  });
}

/**
 * Accept a skill version (§8.1: frozen → accepted).
 * §5.2: one accepted version per skill — supersedes prior accepted.
 * Uses transaction (§5.3).
 */
export async function acceptVersion(versionId: string): Promise<SkillVersion> {
  return prisma.$transaction(async (tx) => {
    const version = await tx.skillVersion.findUniqueOrThrow({
      where: { id: versionId },
    });

    assertValidSkillVersionTransition(
      version.status as SkillVersionStatus,
      "accepted",
    );

    // Supersede any currently accepted version (§5.2)
    const currentAccepted = await tx.skillVersion.findFirst({
      where: { skillId: version.skillId, status: "accepted" },
    });
    if (currentAccepted) {
      assertValidSkillVersionTransition("accepted", "superseded");
      await tx.skillVersion.update({
        where: { id: currentAccepted.id },
        data: { status: "superseded" },
      });
    }

    const updated = await tx.skillVersion.update({
      where: { id: versionId },
      data: { status: "accepted" },
    });

    await tx.skill.update({
      where: { id: version.skillId },
      data: { acceptedVersionId: updated.id },
    });

    return updated;
  });
}

/**
 * Add a file to a skill version. Only allowed for draft versions.
 */
export async function addSkillFile(
  versionId: string,
  input: {
    path: string;
    kind: string;
    storageUri: string;
    sha256: string;
    textPreview?: string;
  },
): Promise<SkillFile> {
  // Verify version is still draft
  const version = await prisma.skillVersion.findUniqueOrThrow({
    where: { id: versionId },
  });
  if (version.status !== "draft") {
    throw new Error(
      `Cannot add files to a ${version.status} skill version`,
    );
  }

  return prisma.skillFile.create({
    data: {
      skillVersionId: versionId,
      path: input.path,
      kind: input.kind,
      storageUri: input.storageUri,
      sha256: input.sha256,
      textPreview: input.textPreview ?? null,
    },
  });
}
