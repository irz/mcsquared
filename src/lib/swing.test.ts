import { describe, expect, it } from "vitest";
import { isSwingEligibleTick, swingDelaySeconds } from "./swing";

describe("swing helpers", () => {
  it("marks the swingable offbeats for eighth and sixteenth lanes", () => {
    expect(isSwingEligibleTick("sixteenth", 0)).toBe(false);
    expect(isSwingEligibleTick("sixteenth", 1)).toBe(true);
    expect(isSwingEligibleTick("eighth", 0)).toBe(false);
    expect(isSwingEligibleTick("eighth", 2)).toBe(true);
    expect(isSwingEligibleTick("quarter", 4)).toBe(false);
    expect(isSwingEligibleTick("whole", 16)).toBe(false);
  });

  it("returns a probabilistic delay from the Web Audio clock domain", () => {
    expect(swingDelaySeconds(120, "sixteenth", 1, 0.6, 1, 0.99)).toBeCloseTo(0.025);
    expect(swingDelaySeconds(120, "sixteenth", 1, 0.6, 0.5, 0.5)).toBe(0);
    expect(swingDelaySeconds(120, "sixteenth", 0, 0.6, 1, 0)).toBe(0);
  });
});
