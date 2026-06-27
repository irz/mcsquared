import { describe, expect, it } from "vitest";
import type { AppEdge } from "../types";
import {
  addEdgeWithProbability,
  normalizeEdgesBySource,
  setEdgeProbability
} from "./probability";

const edge = (id: string, source: string, target: string, probability: number): AppEdge => ({
  id,
  source,
  target,
  type: "probabilityEdge",
  data: { edgeKind: "transition", probability }
});

const outgoingSum = (edges: AppEdge[], source: string) =>
  edges
    .filter((candidate) => candidate.source === source)
    .reduce((sum, candidate) => sum + candidate.data.probability, 0);

describe("probability helpers", () => {
  it("forces a single outgoing edge to probability 1", () => {
    const normalized = normalizeEdgesBySource([edge("e1", "a", "b", 0.4)]);

    expect(normalized[0].data.probability).toBe(1);
  });

  it("adds a new edge while preserving sibling ratios", () => {
    const edges = [edge("e1", "a", "b", 0.75), edge("e2", "a", "c", 0.25)];
    const updated = addEdgeWithProbability(edges, edge("e3", "a", "d", 0));

    expect(outgoingSum(updated, "a")).toBeCloseTo(1);
    expect(updated.find((candidate) => candidate.id === "e1")?.data.probability).toBeCloseTo(0.5);
    expect(updated.find((candidate) => candidate.id === "e2")?.data.probability).toBeCloseTo(
      1 / 6
    );
    expect(updated.find((candidate) => candidate.id === "e3")?.data.probability).toBeCloseTo(
      1 / 3
    );
  });

  it("redistributes edited probability proportionally", () => {
    const edges = [
      edge("e1", "a", "b", 0.5),
      edge("e2", "a", "c", 0.3),
      edge("e3", "a", "d", 0.2)
    ];
    const updated = setEdgeProbability(edges, "e1", 0.8);

    expect(outgoingSum(updated, "a")).toBeCloseTo(1);
    expect(updated.find((candidate) => candidate.id === "e1")?.data.probability).toBeCloseTo(0.8);
    expect(updated.find((candidate) => candidate.id === "e2")?.data.probability).toBeCloseTo(0.12);
    expect(updated.find((candidate) => candidate.id === "e3")?.data.probability).toBeCloseTo(0.08);
  });

  it("keeps unrelated source groups unchanged", () => {
    const edges = [edge("e1", "a", "b", 0.5), edge("e2", "x", "y", 1)];
    const updated = setEdgeProbability(edges, "e1", 1);

    expect(updated.find((candidate) => candidate.id === "e2")?.data.probability).toBe(1);
  });

  it("renormalizes remaining edges after deletion", () => {
    const updated = normalizeEdgesBySource([
      edge("e1", "a", "b", 0.25),
      edge("e2", "a", "c", 0.25),
      edge("e3", "x", "y", 1)
    ]);

    expect(outgoingSum(updated, "a")).toBeCloseTo(1);
    expect(updated.find((candidate) => candidate.id === "e1")?.data.probability).toBeCloseTo(0.5);
    expect(updated.find((candidate) => candidate.id === "e2")?.data.probability).toBeCloseTo(0.5);
  });

  it("preserves clock edges while normalizing transition edges", () => {
    const updated = normalizeEdgesBySource([
      {
        id: "clock",
        source: "master-clock",
        target: "a",
        type: "probabilityEdge",
        data: { edgeKind: "clock", clockDivision: "quarter" }
      },
      edge("e1", "a", "b", 0.2),
      edge("e2", "a", "c", 0.2)
    ]);

    expect(updated.find((candidate) => candidate.id === "clock")?.data.clockDivision).toBe(
      "quarter"
    );
    expect(outgoingSum(updated, "a")).toBeCloseTo(1);
  });
});
