import { describe, expect, it } from "vitest";
import {
  routeOrthogonalEdge,
  routeSelfEdge,
  routeToPath,
  type RoutePoint,
  type RouteRect
} from "./edgeRouting";

const segmentCrossesRect = (start: RoutePoint, end: RoutePoint, rect: RouteRect) => {
  if (start.y === end.y) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);

    return start.y > rect.top && start.y < rect.bottom && maxX > rect.left && minX < rect.right;
  }

  if (start.x === end.x) {
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);

    return start.x > rect.left && start.x < rect.right && maxY > rect.top && minY < rect.bottom;
  }

  return true;
};

describe("edge routing", () => {
  it("routes a backward edge around the source and target boxes", () => {
    const source = { id: "source", left: 300, right: 446, top: 100, bottom: 174 };
    const target = { id: "target", left: 80, right: 226, top: 100, bottom: 174 };
    const route = routeOrthogonalEdge(
      { x: source.right, y: 137 },
      { x: target.left, y: 137 },
      [source, target]
    );

    for (let index = 1; index < route.length; index += 1) {
      expect(segmentCrossesRect(route[index - 1], route[index], source)).toBe(false);
      expect(segmentCrossesRect(route[index - 1], route[index], target)).toBe(false);
    }
  });

  it("routes around an intervening node", () => {
    const middle = { id: "middle", left: 260, right: 406, top: 100, bottom: 174 };
    const route = routeOrthogonalEdge(
      { x: 100, y: 137 },
      { x: 560, y: 137 },
      [middle]
    );

    for (let index = 1; index < route.length; index += 1) {
      expect(segmentCrossesRect(route[index - 1], route[index], middle)).toBe(false);
    }
  });

  it("creates an arc-based circular self route", () => {
    const selfRoute = routeSelfEdge({ x: 200, y: 100 }, { x: 216, y: 100 });

    expect(selfRoute.path).toContain("A ");
    expect(selfRoute.labelX).toBe(208);
    expect(selfRoute.labelY).toBeLessThan(100);
  });

  it("turns route points into a drawable path", () => {
    expect(
      routeToPath([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 }
      ])
    ).toMatch(/^M 0 0 L /);
  });
});
