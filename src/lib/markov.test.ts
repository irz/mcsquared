import { describe, expect, it } from "vitest";
import type { AppEdge } from "../types";
import { chooseNextNodeId } from "./markov";

const edge = (id: string, source: string, target: string, probability: number): AppEdge => ({
  id,
  source,
  target,
  type: "probabilityEdge",
  data: { edgeKind: "transition", probability }
});

describe("chooseNextNodeId", () => {
  it("stays on the current node when there are no outgoing edges", () => {
    expect(chooseNextNodeId("a", [], 0.8)).toBe("a");
  });

  it("stays on the current node when outgoing probabilities total zero", () => {
    expect(chooseNextNodeId("a", [edge("e1", "a", "b", 0)], 0.1)).toBe("a");
  });

  it("chooses by cumulative probability range", () => {
    const edges = [edge("e1", "a", "b", 0.25), edge("e2", "a", "c", 0.75)];

    expect(chooseNextNodeId("a", edges, 0.2)).toBe("b");
    expect(chooseNextNodeId("a", edges, 0.8)).toBe("c");
  });

  it("normalizes stale totals while choosing", () => {
    const edges = [edge("e1", "a", "b", 2), edge("e2", "a", "c", 2)];

    expect(chooseNextNodeId("a", edges, 0.49)).toBe("b");
    expect(chooseNextNodeId("a", edges, 0.51)).toBe("c");
  });

  it("ignores clock edges when choosing Markov transitions", () => {
    const edges: AppEdge[] = [
      {
        id: "clock",
        source: "master-clock",
        target: "a",
        type: "probabilityEdge",
        data: { edgeKind: "clock", clockDivision: "quarter" }
      },
      edge("e1", "a", "b", 1)
    ];

    expect(chooseNextNodeId("a", edges, 0.1)).toBe("b");
  });
});
