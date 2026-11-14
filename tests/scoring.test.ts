import { describe, expect, it } from "vitest";
import { computeScore } from "../lib/scoring";

describe("computeScore", () => {
  it("is 100 when every requirement is met", () => {
    expect(computeScore(["met", "met", "met"])).toBe(100);
  });

  it("is 0 when nothing is met", () => {
    expect(computeScore(["not_met", "not_met"])).toBe(0);
  });

  it("counts partly met as half a point", () => {
    expect(computeScore(["partly_met", "partly_met"])).toBe(50);
    expect(computeScore(["met", "partly_met", "not_met", "not_met"])).toBe(38); // 1.5 / 4 = 37.5 -> 38
  });

  it("rounds to a whole number", () => {
    expect(computeScore(["met", "not_met", "not_met"])).toBe(33);
    expect(computeScore(["met", "met", "not_met"])).toBe(67);
  });

  it("is null when there is nothing to score (for example, every requirement is unverified)", () => {
    expect(computeScore([])).toBeNull();
  });

  it("always stays between 0 and 100", () => {
    const statuses = ["met", "partly_met", "not_met"] as const;
    for (let i = 0; i < 200; i++) {
      const sample = Array.from({ length: 1 + (i % 12) }, (_, j) => statuses[(i * 7 + j * 3) % 3]!);
      const score = computeScore(sample);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score)).toBe(true);
    }
  });
});
