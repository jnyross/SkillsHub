import { describe, it, expect } from "vitest";
import {
  assertValidSkillVersionTransition,
  assertValidEvalSetTransition,
  assertValidRunTransition,
  assertValidComparablePairTransition,
  assertValidIterationTransition,
  assertValidReviewSessionTransition,
} from "../index.js";

describe("§8.1 SkillVersion state machine", () => {
  it("allows draft → frozen", () => {
    expect(() =>
      assertValidSkillVersionTransition("draft", "frozen"),
    ).not.toThrow();
  });

  it("allows frozen → accepted", () => {
    expect(() =>
      assertValidSkillVersionTransition("frozen", "accepted"),
    ).not.toThrow();
  });

  it("allows accepted → superseded", () => {
    expect(() =>
      assertValidSkillVersionTransition("accepted", "superseded"),
    ).not.toThrow();
  });

  it("rejects draft → accepted (must freeze first)", () => {
    expect(() =>
      assertValidSkillVersionTransition("draft", "accepted"),
    ).toThrow("Invalid SkillVersion transition: draft → accepted");
  });

  it("rejects frozen → draft (no going back)", () => {
    expect(() =>
      assertValidSkillVersionTransition("frozen", "draft"),
    ).toThrow("Invalid SkillVersion transition: frozen → draft");
  });

  it("rejects superseded → anything", () => {
    expect(() =>
      assertValidSkillVersionTransition("superseded", "draft"),
    ).toThrow();
    expect(() =>
      assertValidSkillVersionTransition("superseded", "frozen"),
    ).toThrow();
    expect(() =>
      assertValidSkillVersionTransition("superseded", "accepted"),
    ).toThrow();
  });
});

describe("§8.2 EvalSet state machine", () => {
  it("allows draft → frozen", () => {
    expect(() =>
      assertValidEvalSetTransition("draft", "frozen"),
    ).not.toThrow();
  });

  it("rejects frozen → draft", () => {
    expect(() => assertValidEvalSetTransition("frozen", "draft")).toThrow(
      "Invalid EvalSet transition: frozen → draft",
    );
  });

  it("rejects frozen → frozen", () => {
    expect(() => assertValidEvalSetTransition("frozen", "frozen")).toThrow();
  });
});

describe("§8.3 Run state machine", () => {
  it("allows full happy path: queued → provisioning → running → result_received → finalizing → succeeded", () => {
    expect(() =>
      assertValidRunTransition("queued", "provisioning"),
    ).not.toThrow();
    expect(() =>
      assertValidRunTransition("provisioning", "running"),
    ).not.toThrow();
    expect(() =>
      assertValidRunTransition("running", "result_received"),
    ).not.toThrow();
    expect(() =>
      assertValidRunTransition("result_received", "finalizing"),
    ).not.toThrow();
    expect(() =>
      assertValidRunTransition("finalizing", "succeeded"),
    ).not.toThrow();
  });

  it("rejects queued → succeeded (must go through all steps)", () => {
    expect(() =>
      assertValidRunTransition("queued", "succeeded"),
    ).toThrow("Invalid Run transition: queued → succeeded");
  });

  it("allows failure transitions from running", () => {
    expect(() =>
      assertValidRunTransition("running", "running_failed"),
    ).not.toThrow();
    expect(() =>
      assertValidRunTransition("running", "timed_out"),
    ).not.toThrow();
    expect(() =>
      assertValidRunTransition("running", "canceled"),
    ).not.toThrow();
  });

  it("allows cancellation from queued and provisioning", () => {
    expect(() =>
      assertValidRunTransition("queued", "canceled"),
    ).not.toThrow();
    expect(() =>
      assertValidRunTransition("provisioning", "canceled"),
    ).not.toThrow();
  });

  it("rejects transitions from terminal states", () => {
    expect(() =>
      assertValidRunTransition("succeeded", "queued"),
    ).toThrow();
    expect(() =>
      assertValidRunTransition("running_failed", "queued"),
    ).toThrow();
    expect(() =>
      assertValidRunTransition("timed_out", "running"),
    ).toThrow();
    expect(() =>
      assertValidRunTransition("canceled", "queued"),
    ).toThrow();
  });

  it("allows provisioning_failed from provisioning", () => {
    expect(() =>
      assertValidRunTransition("provisioning", "provisioning_failed"),
    ).not.toThrow();
  });

  it("allows finalization_failed from finalizing", () => {
    expect(() =>
      assertValidRunTransition("finalizing", "finalization_failed"),
    ).not.toThrow();
  });
});

describe("§8.4 ComparablePair state machine", () => {
  it("allows pending → awaiting_primary", () => {
    expect(() =>
      assertValidComparablePairTransition("pending", "awaiting_primary"),
    ).not.toThrow();
  });

  it("allows pending → awaiting_baseline", () => {
    expect(() =>
      assertValidComparablePairTransition("pending", "awaiting_baseline"),
    ).not.toThrow();
  });

  it("allows awaiting_primary → comparable", () => {
    expect(() =>
      assertValidComparablePairTransition("awaiting_primary", "comparable"),
    ).not.toThrow();
  });

  it("allows comparable → graded → included_in_benchmark", () => {
    expect(() =>
      assertValidComparablePairTransition("comparable", "graded"),
    ).not.toThrow();
    expect(() =>
      assertValidComparablePairTransition("graded", "included_in_benchmark"),
    ).not.toThrow();
  });

  it("rejects pending → comparable (must go through awaiting states)", () => {
    expect(() =>
      assertValidComparablePairTransition("pending", "comparable"),
    ).toThrow();
  });

  it("allows exclusion from most states", () => {
    expect(() =>
      assertValidComparablePairTransition("pending", "excluded"),
    ).not.toThrow();
    expect(() =>
      assertValidComparablePairTransition("comparable", "excluded"),
    ).not.toThrow();
    expect(() =>
      assertValidComparablePairTransition("graded", "excluded"),
    ).not.toThrow();
  });

  it("rejects transitions from excluded and included_in_benchmark", () => {
    expect(() =>
      assertValidComparablePairTransition("excluded", "pending"),
    ).toThrow();
    expect(() =>
      assertValidComparablePairTransition("included_in_benchmark", "graded"),
    ).toThrow();
  });
});

describe("§8.5 Iteration state machine", () => {
  it("allows full happy path", () => {
    expect(() =>
      assertValidIterationTransition("drafting", "queued"),
    ).not.toThrow();
    expect(() =>
      assertValidIterationTransition("queued", "running"),
    ).not.toThrow();
    expect(() =>
      assertValidIterationTransition("running", "awaiting_pair_finalization"),
    ).not.toThrow();
    expect(() =>
      assertValidIterationTransition(
        "awaiting_pair_finalization",
        "awaiting_grading",
      ),
    ).not.toThrow();
    expect(() =>
      assertValidIterationTransition("awaiting_grading", "benchmark_ready"),
    ).not.toThrow();
    expect(() =>
      assertValidIterationTransition("benchmark_ready", "review_open"),
    ).not.toThrow();
    expect(() =>
      assertValidIterationTransition("review_open", "review_submitted"),
    ).not.toThrow();
    expect(() =>
      assertValidIterationTransition("review_submitted", "completed"),
    ).not.toThrow();
  });

  it("rejects running → awaiting_grading (must go through pair_finalization)", () => {
    expect(() =>
      assertValidIterationTransition("running", "awaiting_grading"),
    ).toThrow();
  });

  it("allows degraded and failed from running", () => {
    expect(() =>
      assertValidIterationTransition("running", "degraded"),
    ).not.toThrow();
    expect(() =>
      assertValidIterationTransition("running", "failed"),
    ).not.toThrow();
  });

  it("rejects transitions from terminal states", () => {
    expect(() =>
      assertValidIterationTransition("completed", "drafting"),
    ).toThrow();
    expect(() =>
      assertValidIterationTransition("failed", "running"),
    ).toThrow();
  });
});

describe("§8.6 ReviewSession state machine", () => {
  it("allows open → submitted → closed", () => {
    expect(() =>
      assertValidReviewSessionTransition("open", "submitted"),
    ).not.toThrow();
    expect(() =>
      assertValidReviewSessionTransition("submitted", "closed"),
    ).not.toThrow();
  });

  it("allows open → stale", () => {
    expect(() =>
      assertValidReviewSessionTransition("open", "stale"),
    ).not.toThrow();
  });

  it("allows open → closed", () => {
    expect(() =>
      assertValidReviewSessionTransition("open", "closed"),
    ).not.toThrow();
  });

  it("rejects stale → submitted", () => {
    expect(() =>
      assertValidReviewSessionTransition("stale", "submitted"),
    ).toThrow();
  });

  it("rejects closed → anything", () => {
    expect(() =>
      assertValidReviewSessionTransition("closed", "open"),
    ).toThrow();
  });
});
