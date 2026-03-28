import { describe, it, expect } from "vitest";
import {
  buildExecutionEnvelope,
  computeComparabilityHash,
  areComparable,
  hashField,
  COMPARABILITY_FIELDS,
  ALLOWED_DIFFERENCE_FIELDS,
} from "../index.js";

function makeEnvelopeInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "env-1",
    runId: "run-1",
    iterationId: "iter-1",
    evalSnapshotId: "snap-1",
    provider: "anthropic",
    modelId: "claude-sonnet-4-20250514",
    modelConfig: { maxTurns: 50 },
    systemPrompt: "You are a helpful assistant.",
    backend: "claude-code" as const,
    toolPolicy: { allowFileIO: true, allowNetwork: false },
    toolList: ["bash", "file_read", "file_write"],
    promptWrapper: "default",
    runnerImageDigest: "sha256:abc123",
    runnerVersion: "claude-code@1.2.3",
    inputManifest: [{ path: "input.txt", sha256: "abc" }],
    inputFiles: [{ path: "input.txt", content: "hello" }],
    timeoutSeconds: 300,
    resourceProfile: { cpu: 2, memoryMb: 4096 },
    envAllowlist: ["HOME", "PATH"],
    skillMode: "with_skill" as const,
    skillBundleHash: "bundle-hash-123",
    availableSkillsContextHash: "ctx-hash-456",
    retryPolicy: { maxRetries: 2 },
    ...overrides,
  };
}

describe("buildExecutionEnvelope", () => {
  it("builds an envelope with all 20+ fields populated", () => {
    const envelope = buildExecutionEnvelope(makeEnvelopeInput());

    // Core identity fields
    expect(envelope.id).toBe("env-1");
    expect(envelope.runId).toBe("run-1");
    expect(envelope.iterationId).toBe("iter-1");
    expect(envelope.evalSnapshotId).toBe("snap-1");

    // Model identity
    expect(envelope.provider).toBe("anthropic");
    expect(envelope.modelId).toBe("claude-sonnet-4-20250514");
    expect(envelope.modelConfigHash).toBeTruthy();
    expect(envelope.systemPromptHash).toBeTruthy();
    expect(envelope.backend).toBe("claude-code");

    // Tool surface
    expect(envelope.toolPolicyHash).toBeTruthy();
    expect(envelope.toolListHash).toBeTruthy();
    expect(envelope.promptWrapperHash).toBeTruthy();

    // Runner identity
    expect(envelope.runnerImageDigest).toBe("sha256:abc123");
    expect(envelope.runnerVersion).toBe("claude-code@1.2.3");
    expect(envelope.transcriptSchemaVersion).toBe("1");

    // Input identity
    expect(envelope.inputManifestHash).toBeTruthy();
    expect(envelope.inputFilesHash).toBeTruthy();
    expect(envelope.timeoutSeconds).toBe(300);
    expect(envelope.resourceProfileHash).toBeTruthy();
    expect(envelope.envAllowlistHash).toBeTruthy();

    // Skill context
    expect(envelope.skillMode).toBe("with_skill");
    expect(envelope.skillBundleHash).toBe("bundle-hash-123");
    expect(envelope.availableSkillsContextHash).toBe("ctx-hash-456");

    // Retry
    expect(envelope.retryPolicyHash).toBeTruthy();

    // Computed
    expect(envelope.comparabilityHash).toMatch(/^sha256:/);
    expect(envelope.createdAt).toBeTruthy();
  });

  it("produces deterministic hashes for same input", () => {
    const input = makeEnvelopeInput();
    const a = buildExecutionEnvelope(input);
    const b = buildExecutionEnvelope(input);
    expect(a.comparabilityHash).toBe(b.comparabilityHash);
    expect(a.modelConfigHash).toBe(b.modelConfigHash);
    expect(a.toolPolicyHash).toBe(b.toolPolicyHash);
  });
});

describe("§9.2 Allowed differences", () => {
  it("same config with different skillMode produces same comparability hash", () => {
    const withSkill = buildExecutionEnvelope(
      makeEnvelopeInput({ skillMode: "with_skill", skillBundleHash: "a" }),
    );
    const withoutSkill = buildExecutionEnvelope(
      makeEnvelopeInput({
        skillMode: "without_skill",
        skillBundleHash: null,
      }),
    );
    expect(withSkill.comparabilityHash).toBe(withoutSkill.comparabilityHash);
  });

  it("different availableSkillsContextHash does not change comparability hash", () => {
    const a = buildExecutionEnvelope(
      makeEnvelopeInput({ availableSkillsContextHash: "hash-a" }),
    );
    const b = buildExecutionEnvelope(
      makeEnvelopeInput({ availableSkillsContextHash: "hash-b" }),
    );
    expect(a.comparabilityHash).toBe(b.comparabilityHash);
  });

  it("different runId does not change comparability hash", () => {
    const a = buildExecutionEnvelope(
      makeEnvelopeInput({ id: "env-a", runId: "run-a" }),
    );
    const b = buildExecutionEnvelope(
      makeEnvelopeInput({ id: "env-b", runId: "run-b" }),
    );
    // runId is excluded from comparability hash but iterationId etc. stay same
    // Actually runId IS in COMPARABILITY_FIELDS check — no, it's in ALLOWED_DIFFERENCE_FIELDS
    // The hash is computed from COMPARABILITY_FIELDS which excludes runId
    expect(a.comparabilityHash).toBe(b.comparabilityHash);
  });
});

describe("§9.3 Comparability hash breaks on non-allowed differences", () => {
  it("different model breaks comparability", () => {
    const a = buildExecutionEnvelope(
      makeEnvelopeInput({ modelId: "claude-sonnet-4-20250514" }),
    );
    const b = buildExecutionEnvelope(
      makeEnvelopeInput({ modelId: "o4-mini" }),
    );
    expect(a.comparabilityHash).not.toBe(b.comparabilityHash);
  });

  it("different backend breaks comparability (cross-backend rejection)", () => {
    const claude = buildExecutionEnvelope(
      makeEnvelopeInput({ backend: "claude-code" }),
    );
    const codex = buildExecutionEnvelope(
      makeEnvelopeInput({ backend: "codex" }),
    );
    expect(claude.comparabilityHash).not.toBe(codex.comparabilityHash);
    expect(areComparable(claude, codex)).toBe(false);
  });

  it("different timeout breaks comparability", () => {
    const a = buildExecutionEnvelope(
      makeEnvelopeInput({ timeoutSeconds: 300 }),
    );
    const b = buildExecutionEnvelope(
      makeEnvelopeInput({ timeoutSeconds: 600 }),
    );
    expect(a.comparabilityHash).not.toBe(b.comparabilityHash);
  });

  it("different tool policy breaks comparability", () => {
    const a = buildExecutionEnvelope(
      makeEnvelopeInput({
        toolPolicy: { allowFileIO: true, allowNetwork: false },
      }),
    );
    const b = buildExecutionEnvelope(
      makeEnvelopeInput({
        toolPolicy: { allowFileIO: true, allowNetwork: true },
      }),
    );
    expect(a.comparabilityHash).not.toBe(b.comparabilityHash);
  });

  it("different system prompt breaks comparability", () => {
    const a = buildExecutionEnvelope(
      makeEnvelopeInput({ systemPrompt: "You are a helpful assistant." }),
    );
    const b = buildExecutionEnvelope(
      makeEnvelopeInput({ systemPrompt: "You are an evil assistant." }),
    );
    expect(a.comparabilityHash).not.toBe(b.comparabilityHash);
  });
});

describe("areComparable", () => {
  it("returns true for comparable envelopes", () => {
    const a = buildExecutionEnvelope(
      makeEnvelopeInput({ skillMode: "with_skill" }),
    );
    const b = buildExecutionEnvelope(
      makeEnvelopeInput({ skillMode: "without_skill" }),
    );
    expect(areComparable(a, b)).toBe(true);
  });

  it("returns false for non-comparable envelopes", () => {
    const a = buildExecutionEnvelope(
      makeEnvelopeInput({ backend: "claude-code" }),
    );
    const b = buildExecutionEnvelope(
      makeEnvelopeInput({ backend: "codex" }),
    );
    expect(areComparable(a, b)).toBe(false);
  });
});

describe("hashField", () => {
  it("produces deterministic output", () => {
    expect(hashField("hello")).toBe(hashField("hello"));
  });

  it("different input produces different hash", () => {
    expect(hashField("hello")).not.toBe(hashField("world"));
  });

  it("returns a hex string", () => {
    expect(hashField("test")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("COMPARABILITY_FIELDS and ALLOWED_DIFFERENCE_FIELDS", () => {
  it("COMPARABILITY_FIELDS does not include any ALLOWED_DIFFERENCE_FIELDS", () => {
    for (const field of ALLOWED_DIFFERENCE_FIELDS) {
      expect(COMPARABILITY_FIELDS).not.toContain(field);
    }
  });

  it("tool config ordering does not affect hash (sorted keys)", () => {
    const a = buildExecutionEnvelope(
      makeEnvelopeInput({
        toolPolicy: { allowNetwork: false, allowFileIO: true },
      }),
    );
    const b = buildExecutionEnvelope(
      makeEnvelopeInput({
        toolPolicy: { allowFileIO: true, allowNetwork: false },
      }),
    );
    expect(a.comparabilityHash).toBe(b.comparabilityHash);
  });

  it("tool list ordering does not affect hash (sorted)", () => {
    const a = buildExecutionEnvelope(
      makeEnvelopeInput({ toolList: ["bash", "file_read", "file_write"] }),
    );
    const b = buildExecutionEnvelope(
      makeEnvelopeInput({ toolList: ["file_write", "bash", "file_read"] }),
    );
    expect(a.comparabilityHash).toBe(b.comparabilityHash);
  });
});
