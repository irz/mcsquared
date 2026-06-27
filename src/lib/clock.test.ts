import { describe, expect, it } from "vitest";
import { CLOCK_PORTS, MASTER_CLOCK_NODE_ID, type AppEdge } from "../types";
import {
  clockDivisionFromHandle,
  divisionsForSixteenthTick,
  firstClockEdge,
  intervalMsForDivision,
  isClockEdge,
  reconcileClockLanes,
  sixteenthIntervalMs
} from "./clock";

const clockEdge = (id: string, target: string, sourceHandle = CLOCK_PORTS.QUARTER): AppEdge => ({
  id,
  source: MASTER_CLOCK_NODE_ID,
  target,
  sourceHandle,
  targetHandle: "input-left",
  type: "probabilityEdge",
  data: { edgeKind: "clock", clockDivision: clockDivisionFromHandle(sourceHandle) ?? "quarter" }
});

const transitionEdge = (id: string): AppEdge => ({
  id,
  source: "a",
  target: "b",
  type: "probabilityEdge",
  data: { edgeKind: "transition", probability: 1 }
});

describe("clock helpers", () => {
  it("maps clock output handles to divisions", () => {
    expect(clockDivisionFromHandle(CLOCK_PORTS.WHOLE)).toBe("whole");
    expect(clockDivisionFromHandle(CLOCK_PORTS.QUARTER)).toBe("quarter");
    expect(clockDivisionFromHandle(CLOCK_PORTS.EIGHTH)).toBe("eighth");
    expect(clockDivisionFromHandle(CLOCK_PORTS.SIXTEENTH)).toBe("sixteenth");
    expect(clockDivisionFromHandle("unknown")).toBeNull();
  });

  it("uses the first clock edge as the entry edge", () => {
    expect(firstClockEdge([transitionEdge("t1"), clockEdge("c1", "a"), clockEdge("c2", "b")])?.id).toBe(
      "c1"
    );
  });

  it("identifies clock edges by source or edge kind", () => {
    expect(isClockEdge(clockEdge("c1", "a"))).toBe(true);
    expect(isClockEdge(transitionEdge("t1"))).toBe(false);
  });

  it("converts divisions to beat intervals", () => {
    expect(intervalMsForDivision(120, "whole")).toBe(2000);
    expect(intervalMsForDivision(120, "quarter")).toBe(500);
    expect(intervalMsForDivision(120, "eighth")).toBe(250);
    expect(intervalMsForDivision(120, "sixteenth")).toBe(125);
    expect(sixteenthIntervalMs(120)).toBe(125);
  });

  it("reconciles active lanes after runtime graph edits", () => {
    const edges = [clockEdge("c1", "a"), clockEdge("c2", "b", CLOCK_PORTS.EIGHTH)];
    const activeLanes = new Map([
      ["c1", "deleted-node"],
      ["c2", "c"],
      ["deleted-clock-edge", "a"]
    ]);
    const reconciled = reconcileClockLanes(edges, new Set(["master-clock", "a", "b", "c"]), activeLanes);

    expect(reconciled.get("c1")).toBe("a");
    expect(reconciled.get("c2")).toBe("c");
    expect(reconciled.has("deleted-clock-edge")).toBe(false);
  });

  it("drops lanes whose clock targets were deleted", () => {
    const reconciled = reconcileClockLanes(
      [clockEdge("c1", "missing")],
      new Set(["master-clock"]),
      new Map([["c1", "a"]])
    );

    expect(reconciled.size).toBe(0);
  });

  it("fires faster divisions together with slower divisions on the master sixteenth grid", () => {
    expect(divisionsForSixteenthTick(0)).toEqual(["whole", "quarter", "eighth", "sixteenth"]);
    expect(divisionsForSixteenthTick(1)).toEqual(["sixteenth"]);
    expect(divisionsForSixteenthTick(2)).toEqual(["eighth", "sixteenth"]);
    expect(divisionsForSixteenthTick(4)).toEqual(["quarter", "eighth", "sixteenth"]);
    expect(divisionsForSixteenthTick(16)).toEqual([
      "whole",
      "quarter",
      "eighth",
      "sixteenth"
    ]);
  });
});
