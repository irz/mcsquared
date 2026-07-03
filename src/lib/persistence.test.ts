import { describe, expect, it } from "vitest";
import {
  CLOCK_PORTS,
  MASTER_CLOCK_NODE_ID,
  MAX_BPM,
  MAX_NODES,
  MIN_BPM,
  NODE_PORTS,
  SWING_PORTS
} from "../types";
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

  it("sanitizes swing nodes and clock routes through them", () => {
    const patch = sanitizePatch({
      version: 1,
      bpm: 112,
      nodes: [
        { id: MASTER_CLOCK_NODE_ID, type: "clockNode", position: { x: 0, y: 0 }, data: {} },
        {
          id: "swing-a",
          type: "swingNode",
          position: { x: 10, y: 20 },
          data: { label: "Lazy Swing", swingAmount: 0.62, swingChance: 0.42 }
        },
        { id: "hat", type: "markovNode", position: { x: 30, y: 40 }, data: { label: "Hat", sampleId: 3 } }
      ],
      edges: [
        {
          id: "clock-to-swing",
          source: MASTER_CLOCK_NODE_ID,
          target: "swing-a",
          sourceHandle: CLOCK_PORTS.SIXTEENTH,
          targetHandle: SWING_PORTS.INPUT,
          data: { edgeKind: "clock", clockDivision: "sixteenth" }
        },
        {
          id: "swing-to-hat",
          source: "swing-a",
          target: "hat",
          sourceHandle: SWING_PORTS.OUTPUT,
          targetHandle: NODE_PORTS.INPUT,
          data: { edgeKind: "clock" }
        }
      ]
    });

    expect(patch?.nodes[1]).toMatchObject({
      id: "swing-a",
      type: "swingNode",
      data: { label: "Lazy Swing", swingAmount: 0.62, swingChance: 0.42 }
    });
    expect(patch?.edges[0]).toMatchObject({
      sourceHandle: CLOCK_PORTS.SIXTEENTH,
      targetHandle: SWING_PORTS.INPUT,
      data: { edgeKind: "clock", clockDivision: "sixteenth" }
    });
    expect(patch?.edges[1]).toMatchObject({
      sourceHandle: SWING_PORTS.OUTPUT,
      targetHandle: NODE_PORTS.INPUT,
      data: { edgeKind: "clock" }
    });
  });
});
