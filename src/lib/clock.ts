import {
  CLOCK_PORTS,
  MASTER_CLOCK_NODE_ID,
  type AppEdge,
  type ClockDivision
} from "../types";

export const clockDivisionLabels: Record<ClockDivision, string> = {
  whole: "Whole",
  quarter: "Quarter",
  eighth: "Eighth",
  sixteenth: "Sixteenth"
};

export const clockDivisionBeatMultipliers: Record<ClockDivision, number> = {
  whole: 4,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25
};

export const clockDivisionTicks: Record<ClockDivision, number> = {
  whole: 16,
  quarter: 4,
  eighth: 2,
  sixteenth: 1
};

export const clockDivisionOrder: ClockDivision[] = ["whole", "quarter", "eighth", "sixteenth"];

export function clockDivisionFromHandle(handleId: string | null | undefined): ClockDivision | null {
  switch (handleId) {
    case CLOCK_PORTS.WHOLE:
      return "whole";
    case CLOCK_PORTS.QUARTER:
      return "quarter";
    case CLOCK_PORTS.EIGHTH:
      return "eighth";
    case CLOCK_PORTS.SIXTEENTH:
      return "sixteenth";
    default:
      return null;
  }
}

export function isClockEdge(edge: AppEdge) {
  return edge.source === MASTER_CLOCK_NODE_ID || edge.data?.edgeKind === "clock";
}

export function isTransitionEdge(edge: AppEdge) {
  return !isClockEdge(edge);
}

export function firstClockEdge(edges: AppEdge[]) {
  return edges.find(isClockEdge);
}

export function clockEdges(edges: AppEdge[]) {
  return edges.filter(isClockEdge);
}

export function reconcileClockLanes(
  edges: AppEdge[],
  nodeIds: Set<string>,
  activeLaneNodeIds: Map<string, string>
) {
  const nextLaneNodeIds = new Map<string, string>();

  for (const edge of clockEdges(edges)) {
    if (!nodeIds.has(edge.target)) {
      continue;
    }

    const activeNodeId = activeLaneNodeIds.get(edge.id);
    nextLaneNodeIds.set(edge.id, activeNodeId && nodeIds.has(activeNodeId) ? activeNodeId : edge.target);
  }

  return nextLaneNodeIds;
}

export function intervalMsForDivision(bpm: number, division: ClockDivision) {
  return (60000 / bpm) * clockDivisionBeatMultipliers[division];
}

export function shouldFireDivision(division: ClockDivision, sixteenthTickIndex: number) {
  return sixteenthTickIndex % clockDivisionTicks[division] === 0;
}

export function divisionsForSixteenthTick(sixteenthTickIndex: number) {
  return clockDivisionOrder.filter((division) =>
    shouldFireDivision(division, sixteenthTickIndex)
  );
}

export function sixteenthIntervalMs(bpm: number) {
  return intervalMsForDivision(bpm, "sixteenth");
}
