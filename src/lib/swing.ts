import type { ClockDivision } from "../types";

export const MIN_SWING_AMOUNT = 0.5;
export const MAX_SWING_AMOUNT = 0.75;
export const DEFAULT_SWING_AMOUNT = 0.58;
export const DEFAULT_SWING_CHANCE = 0.72;

const clampUnit = (value: unknown, fallback: number) => {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, numericValue));
};

export function clampSwingAmount(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_SWING_AMOUNT;
  }

  return Math.min(MAX_SWING_AMOUNT, Math.max(MIN_SWING_AMOUNT, numericValue));
}

export function clampSwingChance(value: unknown) {
  return clampUnit(value, DEFAULT_SWING_CHANCE);
}

export function isSwingEligibleTick(division: ClockDivision, sixteenthTickIndex: number) {
  switch (division) {
    case "sixteenth":
      return sixteenthTickIndex % 2 === 1;
    case "eighth":
      return sixteenthTickIndex % 4 === 2;
    case "quarter":
    case "whole":
      return false;
  }
}

export function swingDelaySeconds(
  bpm: number,
  division: ClockDivision,
  sixteenthTickIndex: number,
  amount: unknown,
  chance: unknown,
  random = Math.random()
) {
  if (!isSwingEligibleTick(division, sixteenthTickIndex) || random >= clampSwingChance(chance)) {
    return 0;
  }

  const beatSeconds = 60 / bpm;
  const eighthSeconds = beatSeconds / 2;

  return Math.max(0, clampSwingAmount(amount) - MIN_SWING_AMOUNT) * eighthSeconds;
}
