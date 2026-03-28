import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createProject } from "../repositories/project-repo.js";
import {
  createSkill,
  createDraftVersion,
  freezeVersion,
  acceptVersion,
  addSkillFile,
  getSkill,
} from "../repositories/skill-repo.js";

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

async function seedProject() {
  return createProject({
    name: "Test",
    slug: `test-${Date.now()}`,
    ownerUserId: "user-1",
  });
}

describe("SkillVersion lifecycle (§8.1)", () => {
  it("creates a draft version", async () => {
    const project = await seedProject();
    const skill = await createSkill({
      projectId: project.id,
      name: "My Skill",
      slug: "my-skill",
    });

    const version = await createDraftVersion(skill.id, {
      frontmatterName: "My Skill",
      frontmatterDescription: "Does things",
      createdBy: "user-1",
    });

    expect(version.status).toBe("draft");
    expect(version.versionNumber).toBe(1);
    expect(version.frontmatterName).toBe("My Skill");

    // Skill should track current draft
    const loaded = await getSkill(skill.id);
    expect(loaded?.currentDraftVersionId).toBe(version.id);
  });

  it("§5.2: rejects second draft for same skill", async () => {
    const project = await seedProject();
    const skill = await createSkill({
      projectId: project.id,
      name: "Skill",
      slug: "skill",
    });

    await createDraftVersion(skill.id, {
      frontmatterName: "V1",
      frontmatterDescription: "First",
      createdBy: "user-1",
    });

    await expect(
      createDraftVersion(skill.id, {
        frontmatterName: "V2",
        frontmatterDescription: "Second",
        createdBy: "user-1",
      }),
    ).rejects.toThrow("already has an active draft version");
  });

  it("freezes a version and clears currentDraftVersionId", async () => {
    const project = await seedProject();
    const skill = await createSkill({
      projectId: project.id,
      name: "Skill",
      slug: "skill",
    });
    const version = await createDraftVersion(skill.id, {
      frontmatterName: "V1",
      frontmatterDescription: "desc",
      createdBy: "user-1",
    });

    const frozen = await freezeVersion(version.id);
    expect(frozen.status).toBe("frozen");

    const loaded = await getSkill(skill.id);
    expect(loaded?.currentDraftVersionId).toBeNull();
  });

  it("accepts a version and sets acceptedVersionId", async () => {
    const project = await seedProject();
    const skill = await createSkill({
      projectId: project.id,
      name: "Skill",
      slug: "skill",
    });
    const version = await createDraftVersion(skill.id, {
      frontmatterName: "V1",
      frontmatterDescription: "desc",
      createdBy: "user-1",
    });

    await freezeVersion(version.id);
    const accepted = await acceptVersion(version.id);

    expect(accepted.status).toBe("accepted");
    const loaded = await getSkill(skill.id);
    expect(loaded?.acceptedVersionId).toBe(accepted.id);
  });

  it("supersedes prior accepted version when accepting new one", async () => {
    const project = await seedProject();
    const skill = await createSkill({
      projectId: project.id,
      name: "Skill",
      slug: "skill",
    });

    // Create and accept v1
    const v1 = await createDraftVersion(skill.id, {
      frontmatterName: "V1",
      frontmatterDescription: "First",
      createdBy: "user-1",
    });
    await freezeVersion(v1.id);
    await acceptVersion(v1.id);

    // Create and accept v2
    const v2 = await createDraftVersion(skill.id, {
      frontmatterName: "V2",
      frontmatterDescription: "Second",
      createdBy: "user-1",
    });
    await freezeVersion(v2.id);
    await acceptVersion(v2.id);

    // v1 should now be superseded
    const v1Loaded = await cleanupClient.skillVersion.findUnique({
      where: { id: v1.id },
    });
    expect(v1Loaded?.status).toBe("superseded");

    // Skill should point to v2
    const loaded = await getSkill(skill.id);
    expect(loaded?.acceptedVersionId).toBe(v2.id);
  });

  it("rejects accepting a draft version", async () => {
    const project = await seedProject();
    const skill = await createSkill({
      projectId: project.id,
      name: "Skill",
      slug: "skill",
    });
    const version = await createDraftVersion(skill.id, {
      frontmatterName: "V1",
      frontmatterDescription: "desc",
      createdBy: "user-1",
    });

    await expect(acceptVersion(version.id)).rejects.toThrow(
      "Invalid SkillVersion transition: draft → accepted",
    );
  });
});

describe("SkillFile management", () => {
  it("adds files to a draft version", async () => {
    const project = await seedProject();
    const skill = await createSkill({
      projectId: project.id,
      name: "Skill",
      slug: "skill",
    });
    const version = await createDraftVersion(skill.id, {
      frontmatterName: "V1",
      frontmatterDescription: "desc",
      createdBy: "user-1",
    });

    const file = await addSkillFile(version.id, {
      path: "SKILL.md",
      kind: "skill_md",
      storageUri: "s3://bucket/skills/v1/SKILL.md",
      sha256: "abc123",
      textPreview: "# My Skill\n\nDoes things.",
    });

    expect(file.path).toBe("SKILL.md");
    expect(file.kind).toBe("skill_md");
  });

  it("rejects adding files to a frozen version", async () => {
    const project = await seedProject();
    const skill = await createSkill({
      projectId: project.id,
      name: "Skill",
      slug: "skill",
    });
    const version = await createDraftVersion(skill.id, {
      frontmatterName: "V1",
      frontmatterDescription: "desc",
      createdBy: "user-1",
    });
    await freezeVersion(version.id);

    await expect(
      addSkillFile(version.id, {
        path: "SKILL.md",
        kind: "skill_md",
        storageUri: "s3://bucket/skills/v1/SKILL.md",
        sha256: "abc123",
      }),
    ).rejects.toThrow("Cannot add files to a frozen skill version");
  });
});
