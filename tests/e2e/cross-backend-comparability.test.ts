import { describe, it, expect } from "vitest";
import { comparabilityHash, areComparable } from "@skillshub/execution";
import type { ExecutionEnvelope } from "@skillshub/execution";

describe("Cross-Backend Comparability Rejection", () => {
  const makeEnvelope = (overrides: Partial<ExecutionEnvelope>): ExecutionEnvelope => ({
    runId: "run_1",
    iterationId: "iter_1",
    evalCaseId: "eval-001",
    mode: "with_skill",
    backend: "claude-code",
    provider: "anthropic",
    modelId: "claude-sonnet-4-20250514",
    runnerVersion: "claude-code@1.0.0",
    toolConfig: { allowFileIO: true, allowNetwork: false },
    startedAt: new Date().toISOString(),
    status: "pending",
    ...overrides,
  });

  it("should produce different hashes for claude-code vs codex backends", () => {
    const claudeEnvelope = makeEnvelope({
      runId: "run_claude",
      backend: "claude-code",
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      runnerVersion: "claude-code@1.0.0",
    });

    const codexEnvelope = makeEnvelope({
      runId: "run_codex",
      backend: "codex",
      provider: "openai",
      modelId: "o4-mini",
      runnerVersion: "codex@0.5.0",
    });

    const claudeHash = comparabilityHash(claudeEnvelope);
    const codexHash = comparabilityHash(codexEnvelope);

    expect(claudeHash).not.toBe(codexHash);
    expect(areComparable(claudeEnvelope, codexEnvelope)).toBe(false);
  });

  it("should produce same hash for same backend with different modes", () => {
    const withSkill = makeEnvelope({
      runId: "run_1",
      mode: "with_skill",
    });

    const withoutSkill = makeEnvelope({
      runId: "run_2",
      mode: "without_skill",
    });

    expect(comparabilityHash(withSkill)).toBe(comparabilityHash(withoutSkill));
    expect(areComparable(withSkill, withoutSkill)).toBe(true);
  });

  it("should produce different hashes when model differs within same backend", () => {
    const sonnet = makeEnvelope({
      runId: "run_1",
      modelId: "claude-sonnet-4-20250514",
    });

    const opus = makeEnvelope({
      runId: "run_2",
      modelId: "claude-opus-4-20250514",
    });

    expect(comparabilityHash(sonnet)).not.toBe(comparabilityHash(opus));
    expect(areComparable(sonnet, opus)).toBe(false);
  });

  it("should produce different hashes when tool config differs", () => {
    const fileIO = makeEnvelope({
      runId: "run_1",
      toolConfig: { allowFileIO: true, allowNetwork: false },
    });

    const network = makeEnvelope({
      runId: "run_2",
      toolConfig: { allowFileIO: true, allowNetwork: true },
    });

    expect(comparabilityHash(fileIO)).not.toBe(comparabilityHash(network));
    expect(areComparable(fileIO, network)).toBe(false);
  });

  it("should produce same hash regardless of run timing fields", () => {
    const early = makeEnvelope({
      runId: "run_early",
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:05:00Z",
      status: "completed",
    });

    const late = makeEnvelope({
      runId: "run_late",
      startedAt: "2026-06-15T12:00:00Z",
      completedAt: "2026-06-15T12:10:00Z",
      status: "completed",
    });

    expect(comparabilityHash(early)).toBe(comparabilityHash(late));
    expect(areComparable(early, late)).toBe(true);
  });

  it("should mark cross-backend pairs as excluded (not comparable)", () => {
    const claudeRun = makeEnvelope({
      runId: "run_claude",
      backend: "claude-code",
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      runnerVersion: "claude-code@1.0.0",
      mode: "with_skill",
    });

    const codexRun = makeEnvelope({
      runId: "run_codex",
      backend: "codex",
      provider: "openai",
      modelId: "o4-mini",
      runnerVersion: "codex@0.5.0",
      mode: "without_skill",
    });

    // These should NOT be comparable — cross-backend pairs must be excluded
    expect(areComparable(claudeRun, codexRun)).toBe(false);

    // Simulate pair exclusion logic
    const pairStatus = areComparable(claudeRun, codexRun) ? "included" : "excluded";
    expect(pairStatus).toBe("excluded");
  });
});
