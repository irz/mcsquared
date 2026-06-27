import type { Edge, Node } from "@xyflow/react";

export const MIN_BPM = 1;
export const MAX_BPM = 400;
export const MAX_NODES = 64;
export const PATCH_STORAGE_KEY = "probabilistic-sample-player:patch:v1";
export const MASTER_CLOCK_NODE_ID = "master-clock";
export const SAMPLE_IDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const NODE_PORTS = {
  INPUT: "input-left",
  OUTPUT: "output-right",
  SELF_SOURCE: "self-source-top",
  SELF_TARGET: "self-target-top"
} as const;

export const NODE_BOX = {
  WIDTH: 146,
  HEIGHT: 74
} as const;

export const CLOCK_DIVISIONS = ["whole", "quarter", "eighth", "sixteenth"] as const;
export const CLOCK_PORTS = {
  WHOLE: "clock-whole",
  QUARTER: "clock-quarter",
  EIGHTH: "clock-eighth",
  SIXTEENTH: "clock-sixteenth"
} as const;

export type NumberedSampleId = (typeof SAMPLE_IDS)[number];
export type SampleId = NumberedSampleId | null;
export type ClockDivision = (typeof CLOCK_DIVISIONS)[number];
export type EdgeKind = "transition" | "clock";

export type GraphNodeData = Record<string, unknown> & {
  label: string;
  sampleId?: SampleId;
  isActive?: boolean;
  bpm?: number;
};

export type GraphEdgeData = Record<string, unknown> & {
  edgeKind: EdgeKind;
  probability?: number;
  clockDivision?: ClockDivision;
};

export type AppNode = Node<GraphNodeData, "markovNode" | "clockNode">;
export type AppEdge = Edge<GraphEdgeData, "probabilityEdge">;

export type PatchState = {
  version: 1;
  nodes: AppNode[];
  edges: AppEdge[];
  bpm: number;
};
