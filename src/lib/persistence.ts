import {
  MAX_BPM,
  MAX_NODES,
  MASTER_CLOCK_NODE_ID,
  MIN_BPM,
  CLOCK_PORTS,
  NODE_PORTS,
  PATCH_STORAGE_KEY,
  SAMPLE_IDS,
  type AppEdge,
  type AppNode,
  type NumberedSampleId,
  type PatchState,
  type SampleId
} from "../types";
import { clockDivisionFromHandle, isClockEdge } from "./clock";
import { normalizeEdgesBySource } from "./probability";

const clampBpm = (value: unknown) => {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return 120;
  }

  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(numericValue)));
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNumberedSampleId = (value: unknown): value is NumberedSampleId =>
  SAMPLE_IDS.includes(value as NumberedSampleId);

const parseSampleId = (value: unknown): SampleId => (isNumberedSampleId(value) ? value : null);

function parseNode(value: unknown): AppNode | null {
  if (!isObject(value) || typeof value.id !== "string" || !isObject(value.position)) {
    return null;
  }

  const position = value.position as Record<string, unknown>;
  const x = typeof position.x === "number" && Number.isFinite(position.x) ? position.x : 0;
  const y = typeof position.y === "number" && Number.isFinite(position.y) ? position.y : 0;
  const data = isObject(value.data) ? value.data : {};

  const isClockNode = value.id === MASTER_CLOCK_NODE_ID || value.type === "clockNode";

  return {
    id: isClockNode ? MASTER_CLOCK_NODE_ID : value.id,
    type: isClockNode ? "clockNode" : "markovNode",
    position: { x, y },
    data: {
      label:
        typeof data.label === "string" && data.label.trim()
          ? data.label
          : isClockNode
            ? "Master Clock"
            : value.id,
      sampleId: isClockNode ? null : parseSampleId(data.sampleId)
    }
  };
}

function parseEdge(value: unknown, nodeIds: Set<string>): AppEdge | null {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.source !== "string" ||
    typeof value.target !== "string" ||
    !nodeIds.has(value.source) ||
    !nodeIds.has(value.target)
  ) {
    return null;
  }

  const data = isObject(value.data) ? value.data : {};
  const rawSourceHandle =
    typeof value.sourceHandle === "string" ? value.sourceHandle : undefined;
  const rawTargetHandle =
    typeof value.targetHandle === "string" ? value.targetHandle : undefined;
  const isClockConnection = value.source === MASTER_CLOCK_NODE_ID || data.edgeKind === "clock";
  const clockDivision = isClockConnection
    ? clockDivisionFromHandle(rawSourceHandle) ??
      (typeof data.clockDivision === "string" ? data.clockDivision : undefined)
    : undefined;
  const probability =
    typeof data.probability === "number" && Number.isFinite(data.probability)
      ? data.probability
      : 0;
  const isSelfEdge = value.source === value.target;

  return {
    id: value.id,
    source: value.source,
    target: value.target,
    sourceHandle: isClockConnection
      ? rawSourceHandle ?? CLOCK_PORTS.QUARTER
      : isSelfEdge
        ? NODE_PORTS.SELF_SOURCE
        : NODE_PORTS.OUTPUT,
    targetHandle: isSelfEdge ? NODE_PORTS.SELF_TARGET : NODE_PORTS.INPUT,
    type: "probabilityEdge",
    data: isClockConnection
      ? {
          edgeKind: "clock",
          clockDivision:
            clockDivision === "whole" ||
            clockDivision === "quarter" ||
            clockDivision === "eighth" ||
            clockDivision === "sixteenth"
              ? clockDivision
              : "quarter"
        }
      : { edgeKind: "transition", probability }
  };
}

const createClockNode = (bpm: number): AppNode => ({
  id: MASTER_CLOCK_NODE_ID,
  type: "clockNode",
  position: { x: -120, y: 150 },
  data: {
    label: "Master Clock",
    bpm
  }
});

export function sanitizePatch(value: unknown): PatchState | null {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.nodes)) {
    return null;
  }

  const parsedNodes = value.nodes.map(parseNode).filter((node): node is AppNode => node !== null);
  const bpm = clampBpm(value.bpm);
  const restoredClockNode = parsedNodes.find((node) => node.id === MASTER_CLOCK_NODE_ID);
  const markovNodes = parsedNodes.filter((node) => node.id !== MASTER_CLOCK_NODE_ID);
  const limitedNodes = [
    restoredClockNode
      ? {
          ...restoredClockNode,
          type: "clockNode" as const,
          data: { ...restoredClockNode.data, label: "Master Clock", bpm }
        }
      : createClockNode(bpm),
    ...markovNodes.slice(0, MAX_NODES)
  ];
  const nodeIds = new Set(limitedNodes.map((node) => node.id));
  const rawEdges = Array.isArray(value.edges) ? value.edges : [];
  const edges = rawEdges
    .map((edge) => parseEdge(edge, nodeIds))
    .filter((edge): edge is AppEdge => edge !== null);
  const legacyStartNodeId =
    typeof value.startNodeId === "string" && nodeIds.has(value.startNodeId)
      ? value.startNodeId
      : parsedNodes.find((node) => node.data.isStart === true && nodeIds.has(node.id))?.id;
  const hasClockEdge = edges.some(isClockEdge);
  const migratedEdges =
    !hasClockEdge && legacyStartNodeId && legacyStartNodeId !== MASTER_CLOCK_NODE_ID
      ? [
          {
            id: `edge-clock-${legacyStartNodeId}`,
            source: MASTER_CLOCK_NODE_ID,
            target: legacyStartNodeId,
            sourceHandle: CLOCK_PORTS.QUARTER,
            targetHandle: NODE_PORTS.INPUT,
            type: "probabilityEdge" as const,
            data: { edgeKind: "clock" as const, clockDivision: "quarter" as const }
          },
          ...edges
        ]
      : edges;

  return {
    version: 1,
    nodes: limitedNodes,
    edges: normalizeEdgesBySource(migratedEdges),
    bpm
  };
}

export function parseStoredPatch(rawValue: string | null): PatchState | null {
  if (!rawValue) {
    return null;
  }

  try {
    return sanitizePatch(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

export function loadStoredPatch(): PatchState | null {
  if (typeof window === "undefined") {
    return null;
  }

  return parseStoredPatch(window.localStorage.getItem(PATCH_STORAGE_KEY));
}

export function saveStoredPatch(patch: PatchState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PATCH_STORAGE_KEY, JSON.stringify(patch));
}
