import type { AppEdge } from "../types";
import { isTransitionEdge } from "./clock";

const EPSILON = 0.000001;

const clampProbability = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
};

const sumProbabilities = (edges: AppEdge[]) =>
  edges.reduce((sum, edge) => sum + clampProbability(edge.data?.probability ?? 0), 0);

const withProbability = (edge: AppEdge, probability: number): AppEdge => ({
  ...edge,
  data: {
    ...edge.data,
    edgeKind: "transition",
    probability: clampProbability(probability)
  }
});

export const probabilityPercent = (probability: number) =>
  `${Math.round(clampProbability(probability) * 100)}%`;

export function normalizeEdgeGroup(edges: AppEdge[]): AppEdge[] {
  if (edges.length === 0) {
    return edges;
  }

  if (edges.length === 1) {
    return [withProbability(edges[0], 1)];
  }

  const total = sumProbabilities(edges);

  if (total <= EPSILON) {
    const equal = 1 / edges.length;
    return edges.map((edge) => withProbability(edge, equal));
  }

  let remaining = 1;
  return edges.map((edge, index) => {
    const probability =
      index === edges.length - 1
        ? remaining
        : clampProbability((edge.data?.probability ?? 0) / total);
    remaining -= probability;
    return withProbability(edge, probability);
  });
}

export function normalizeEdgesBySource(edges: AppEdge[]): AppEdge[] {
  const sourceOrder: string[] = [];
  const groups = new Map<string, AppEdge[]>();

  for (const edge of edges) {
    if (!isTransitionEdge(edge)) {
      continue;
    }

    if (!groups.has(edge.source)) {
      groups.set(edge.source, []);
      sourceOrder.push(edge.source);
    }

    groups.get(edge.source)!.push(edge);
  }

  const normalizedById = new Map<string, AppEdge>();
  for (const source of sourceOrder) {
    for (const edge of normalizeEdgeGroup(groups.get(source)!)) {
      normalizedById.set(edge.id, edge);
    }
  }

  return edges.map((edge) => normalizedById.get(edge.id) ?? edge);
}

export function addEdgeWithProbability(edges: AppEdge[], newEdge: AppEdge): AppEdge[] {
  if (!isTransitionEdge(newEdge)) {
    return [...edges, newEdge];
  }

  const siblingEdges = edges.filter(
    (edge) => edge.source === newEdge.source && isTransitionEdge(edge)
  );

  if (siblingEdges.length === 0) {
    return [...edges, withProbability(newEdge, 1)];
  }

  const newProbability = 1 / (siblingEdges.length + 1);
  const siblingScale = 1 - newProbability;
  const siblingTotal = sumProbabilities(siblingEdges);

  const updatedSiblings =
    siblingTotal <= EPSILON
      ? siblingEdges.map((edge) => withProbability(edge, siblingScale / siblingEdges.length))
      : siblingEdges.map((edge) =>
          withProbability(edge, ((edge.data?.probability ?? 0) / siblingTotal) * siblingScale)
        );

  const updatedById = new Map(updatedSiblings.map((edge) => [edge.id, edge]));

  return [
    ...edges.map((edge) => updatedById.get(edge.id) ?? edge),
    withProbability(newEdge, newProbability)
  ];
}

export function setEdgeProbability(edges: AppEdge[], edgeId: string, probability: number): AppEdge[] {
  const targetEdge = edges.find((edge) => edge.id === edgeId);

  if (!targetEdge || !isTransitionEdge(targetEdge)) {
    return edges;
  }

  const siblings = edges.filter(
    (edge) => edge.source === targetEdge.source && edge.id !== edgeId && isTransitionEdge(edge)
  );

  if (siblings.length === 0) {
    return edges.map((edge) => (edge.id === edgeId ? withProbability(edge, 1) : edge));
  }

  const nextProbability = clampProbability(probability);
  const remainingProbability = 1 - nextProbability;
  const siblingTotal = sumProbabilities(siblings);

  let remaining = remainingProbability;
  const updatedSiblings = siblings.map((edge, index) => {
    const redistributed =
      index === siblings.length - 1
        ? remaining
        : siblingTotal <= EPSILON
          ? remainingProbability / siblings.length
          : ((edge.data?.probability ?? 0) / siblingTotal) * remainingProbability;

    remaining -= redistributed;
    return withProbability(edge, redistributed);
  });

  const updatedById = new Map<string, AppEdge>([
    [edgeId, withProbability(targetEdge, nextProbability)],
    ...updatedSiblings.map((edge) => [edge.id, edge] as const)
  ]);

  return edges.map((edge) => updatedById.get(edge.id) ?? edge);
}
