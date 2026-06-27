import { describe, expect, it } from "vitest";
import { CLOCK_PORTS, MASTER_CLOCK_NODE_ID, MAX_BPM, MAX_NODES, MIN_BPM } from "../types";
import { parseStoredPatch, sanitizePatch } from "./persistence";

describe("persistence helpers", () => {
  it("returns null for missing, invalid, or unsupported stored values", () => {
    expect(parseStoredPatch(null)).toBeNull();
    expect(parseStoredPatch("{")).toBeNull();
    expect(sanitizePatch({ version: 0, nodes: [] })).toBeNull();
  });

  it("sanitizes nodes, edges, bpm, and migrates legacy start node", () => {
    const patch = sanitizePatch({
      version: 1,
      bpm: MAX_BPM + 40,
      startNodeId: "b",
      nodes: [
        { id: "a", position: { x: 0, y: 0 }, data: { label: "A", sampleId: 99 } },
        { id: "b", position: { x: 20, y: 30 }, data: { label: "B", sampleId: 2 } }
      ],
      edges: [
        { id: "e1", source: "a", target: "b", data: { probability: 2 } },
        { id: "bad", source: "a", target: "missing", data: { probability: 1 } }
      ]
    });

    expect(patch?.bpm).toBe(MAX_BPM);
    expect(patch?.nodes[0].id).toBe(MASTER_CLOCK_NODE_ID);
    expect(patch?.nodes[1].data.sampleId).toBeNull();
    expect(patch?.nodes[2].data.sampleId).toBe(2);
    expect(patch?.edges).toHaveLength(2);
    expect(patch?.edges[0].source).toBe(MASTER_CLOCK_NODE_ID);
    expect(patch?.edges[0].target).toBe("b");
    expect(patch?.edges[0].sourceHandle).toBe(CLOCK_PORTS.QUARTER);
    expect(patch?.edges[1].data.probability).toBe(1);
  });

  it("limits restored nodes to the supported maximum", () => {
    const patch = sanitizePatch({
      version: 1,
      bpm: MIN_BPM,
      nodes: Array.from({ length: MAX_NODES + 4 }, (_, index) => ({
        id: `node-${index}`,
        position: { x: index, y: index },
        data: { label: `Node ${index}`, sampleId: null }
      })),
      edges: []
    });

    expect(patch?.nodes).toHaveLength(MAX_NODES + 1);
    expect(patch?.nodes[0].id).toBe(MASTER_CLOCK_NODE_ID);
  });
});
