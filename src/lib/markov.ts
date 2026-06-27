import type { AppEdge } from "../types";
import { isTransitionEdge } from "./clock";

export function chooseNextNodeId(
  currentNodeId: string,
  edges: AppEdge[],
  random = Math.random()
): string {
  const outgoingEdges = edges.filter(
    (edge) => edge.source === currentNodeId && isTransitionEdge(edge)
  );

  if (outgoingEdges.length === 0) {
    return currentNodeId;
  }

  const total = outgoingEdges.reduce(
    (sum, edge) => sum + Math.max(0, edge.data?.probability ?? 0),
    0
  );

  if (total <= 0) {
    return currentNodeId;
  }

  const threshold = Math.min(0.999999999, Math.max(0, random)) * total;
  let accumulator = 0;

  for (const edge of outgoingEdges) {
    accumulator += Math.max(0, edge.data?.probability ?? 0);
    if (threshold < accumulator) {
      return edge.target;
    }
  }

  return outgoingEdges[outgoingEdges.length - 1].target;
}
