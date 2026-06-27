import {
  BaseEdge,
  EdgeLabelRenderer,
  useReactFlow,
  type EdgeProps
} from "@xyflow/react";
import { routeOrthogonalEdge, routeSelfEdge, routeToPath, type RoutePoint } from "../lib/edgeRouting";
import { clockDivisionLabels, isClockEdge } from "../lib/clock";
import { probabilityPercent } from "../lib/probability";
import { NODE_BOX, type AppEdge, type AppNode } from "../types";

const routeMidpoint = (points: RoutePoint[]) => {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  if (points.length === 1) {
    return points[0];
  }

  const lengths = points.slice(1).map((point, index) => {
    const previous = points[index];
    return Math.hypot(point.x - previous.x, point.y - previous.y);
  });
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = totalLength / 2;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const length = lengths[index - 1];

    if (remaining <= length) {
      const ratio = length === 0 ? 0 : remaining / length;

      return {
        x: previous.x + (current.x - previous.x) * ratio,
        y: previous.y + (current.y - previous.y) * ratio
      };
    }

    remaining -= length;
  }

  return points[points.length - 1];
};

export function ProbabilityEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  data,
  selected,
  source,
  target
}: EdgeProps<AppEdge>) {
  const { getNodes } = useReactFlow<AppNode, AppEdge>();
  const isSelfEdge = source === target;
  const isClockConnection = isClockEdge({
    id,
    source,
    target,
    type: "probabilityEdge",
    data: data ?? { edgeKind: "transition" }
  });
  const start = { x: sourceX, y: sourceY };
  const end = { x: targetX, y: targetY };
  const rects = getNodes().map((node) => {
    const width = node.measured?.width ?? NODE_BOX.WIDTH;
    const height = node.measured?.height ?? NODE_BOX.HEIGHT;

    return {
      id: node.id,
      left: node.position.x,
      right: node.position.x + width,
      top: node.position.y,
      bottom: node.position.y + height
    };
  });
  const routed = isSelfEdge
    ? routeSelfEdge(start, end)
    : (() => {
        const points = routeOrthogonalEdge(start, end, rects);
        const label = routeMidpoint(points);

        return {
          path: routeToPath(points),
          labelX: label.x,
          labelY: label.y
        };
      })();

  return (
    <>
      <BaseEdge
        id={id}
        path={routed.path}
        markerEnd={markerEnd}
        className={selected ? "probability-edge is-selected" : "probability-edge"}
      />
      <EdgeLabelRenderer>
        <div
          className={selected ? "edge-label is-selected" : "edge-label"}
          style={{
            transform: `translate(-50%, -50%) translate(${routed.labelX}px, ${routed.labelY}px)`
          }}
        >
          {isClockConnection && data?.clockDivision
            ? clockDivisionLabels[data.clockDivision]
            : probabilityPercent(data?.probability ?? 0)}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
