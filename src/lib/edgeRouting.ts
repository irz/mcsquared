export type RoutePoint = {
  x: number;
  y: number;
};

export type RouteRect = {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const ROUTE_MARGIN = 32;
const OBSTACLE_PADDING = 18;
const CORNER_RADIUS = 14;
const FLOAT_PRECISION = 1000;

const roundCoordinate = (value: number) => Math.round(value * FLOAT_PRECISION) / FLOAT_PRECISION;

const pointKey = (point: RoutePoint) => `${roundCoordinate(point.x)},${roundCoordinate(point.y)}`;

const inflateRect = (rect: RouteRect): RouteRect => ({
  id: rect.id,
  left: roundCoordinate(rect.left - OBSTACLE_PADDING),
  right: roundCoordinate(rect.right + OBSTACLE_PADDING),
  top: roundCoordinate(rect.top - OBSTACLE_PADDING),
  bottom: roundCoordinate(rect.bottom + OBSTACLE_PADDING)
});

const isInsideRect = (point: RoutePoint, rect: RouteRect) =>
  point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom;

const isPointBlocked = (point: RoutePoint, obstacles: RouteRect[]) =>
  obstacles.some((rect) => isInsideRect(point, rect));

const isHorizontalBlocked = (start: RoutePoint, end: RoutePoint, obstacles: RouteRect[]) => {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);

  return obstacles.some(
    (rect) => start.y > rect.top && start.y < rect.bottom && maxX > rect.left && minX < rect.right
  );
};

const isVerticalBlocked = (start: RoutePoint, end: RoutePoint, obstacles: RouteRect[]) => {
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  return obstacles.some(
    (rect) => start.x > rect.left && start.x < rect.right && maxY > rect.top && minY < rect.bottom
  );
};

const isSegmentBlocked = (start: RoutePoint, end: RoutePoint, obstacles: RouteRect[]) => {
  if (start.x === end.x) {
    return isVerticalBlocked(start, end, obstacles);
  }

  if (start.y === end.y) {
    return isHorizontalBlocked(start, end, obstacles);
  }

  return true;
};

const uniqueSortedCoordinates = (values: number[]) =>
  Array.from(new Set(values.map(roundCoordinate))).sort((a, b) => a - b);

class RouteQueue {
  private items: Array<{ key: string; cost: number }> = [];

  push(key: string, cost: number) {
    this.items.push({ key, cost });
    let index = this.items.length - 1;

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);

      if (this.items[parentIndex].cost <= cost) {
        break;
      }

      [this.items[index], this.items[parentIndex]] = [this.items[parentIndex], this.items[index]];
      index = parentIndex;
    }
  }

  pop() {
    if (this.items.length === 0) {
      return undefined;
    }

    const item = this.items[0];
    const last = this.items.pop();

    if (last && this.items.length > 0) {
      this.items[0] = last;
      let index = 0;

      while (true) {
        const leftIndex = index * 2 + 1;
        const rightIndex = index * 2 + 2;
        let smallestIndex = index;

        if (
          leftIndex < this.items.length &&
          this.items[leftIndex].cost < this.items[smallestIndex].cost
        ) {
          smallestIndex = leftIndex;
        }

        if (
          rightIndex < this.items.length &&
          this.items[rightIndex].cost < this.items[smallestIndex].cost
        ) {
          smallestIndex = rightIndex;
        }

        if (smallestIndex === index) {
          break;
        }

        [this.items[index], this.items[smallestIndex]] = [
          this.items[smallestIndex],
          this.items[index]
        ];
        index = smallestIndex;
      }
    }

    return item;
  }

  get length() {
    return this.items.length;
  }
}

const distance = (start: RoutePoint, end: RoutePoint) =>
  Math.abs(start.x - end.x) + Math.abs(start.y - end.y);

const fallbackRoute = (start: RoutePoint, end: RoutePoint, obstacles: RouteRect[]) => {
  const laneY =
    Math.min(start.y, end.y, ...obstacles.map((obstacle) => obstacle.top)) - ROUTE_MARGIN;

  return [
    start,
    { x: start.x + ROUTE_MARGIN, y: start.y },
    { x: start.x + ROUTE_MARGIN, y: laneY },
    { x: end.x - ROUTE_MARGIN, y: laneY },
    { x: end.x - ROUTE_MARGIN, y: end.y },
    end
  ];
};

const simplifyRoute = (points: RoutePoint[]) => {
  const withoutDuplicates = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || point.x !== previous.x || point.y !== previous.y;
  });

  return withoutDuplicates.filter((point, index) => {
    const previous = withoutDuplicates[index - 1];
    const next = withoutDuplicates[index + 1];

    if (!previous || !next) {
      return true;
    }

    const sameVertical = previous.x === point.x && point.x === next.x;
    const sameHorizontal = previous.y === point.y && point.y === next.y;

    return !sameVertical && !sameHorizontal;
  });
};

export function routeOrthogonalEdge(
  start: RoutePoint,
  end: RoutePoint,
  rects: RouteRect[]
): RoutePoint[] {
  const obstacles = rects.map(inflateRect);
  const routeStart = { x: roundCoordinate(start.x + ROUTE_MARGIN), y: roundCoordinate(start.y) };
  const routeEnd = { x: roundCoordinate(end.x - ROUTE_MARGIN), y: roundCoordinate(end.y) };
  const xs = uniqueSortedCoordinates([
    routeStart.x,
    routeEnd.x,
    ...obstacles.flatMap((rect) => [rect.left, rect.right])
  ]);
  const ys = uniqueSortedCoordinates([
    routeStart.y,
    routeEnd.y,
    ...obstacles.flatMap((rect) => [rect.top, rect.bottom])
  ]);
  const points = new Map<string, RoutePoint>();
  const validKeys = new Set<string>();

  for (const x of xs) {
    for (const y of ys) {
      const point = { x, y };
      const key = pointKey(point);

      points.set(key, point);

      if (!isPointBlocked(point, obstacles) || key === pointKey(routeStart) || key === pointKey(routeEnd)) {
        validKeys.add(key);
      }
    }
  }

  const startKey = pointKey(routeStart);
  const endKey = pointKey(routeEnd);
  validKeys.add(startKey);
  validKeys.add(endKey);

  const getNeighbors = (point: RoutePoint) => {
    const neighbors: RoutePoint[] = [];
    const xIndex = xs.indexOf(point.x);
    const yIndex = ys.indexOf(point.y);

    for (const nextXIndex of [xIndex - 1, xIndex + 1]) {
      if (nextXIndex < 0 || nextXIndex >= xs.length) {
        continue;
      }

      const nextPoint = { x: xs[nextXIndex], y: point.y };
      const nextKey = pointKey(nextPoint);

      if (validKeys.has(nextKey) && !isSegmentBlocked(point, nextPoint, obstacles)) {
        neighbors.push(nextPoint);
      }
    }

    for (const nextYIndex of [yIndex - 1, yIndex + 1]) {
      if (nextYIndex < 0 || nextYIndex >= ys.length) {
        continue;
      }

      const nextPoint = { x: point.x, y: ys[nextYIndex] };
      const nextKey = pointKey(nextPoint);

      if (validKeys.has(nextKey) && !isSegmentBlocked(point, nextPoint, obstacles)) {
        neighbors.push(nextPoint);
      }
    }

    return neighbors;
  };

  const queue = new RouteQueue();
  const costs = new Map<string, number>([[startKey, 0]]);
  const previousByKey = new Map<string, string>();
  queue.push(startKey, 0);

  while (queue.length > 0) {
    const current = queue.pop();

    if (!current) {
      break;
    }

    if (current.key === endKey) {
      break;
    }

    if (current.cost > (costs.get(current.key) ?? Infinity)) {
      continue;
    }

    const currentPoint = points.get(current.key);

    if (!currentPoint) {
      continue;
    }

    for (const neighbor of getNeighbors(currentPoint)) {
      const neighborKey = pointKey(neighbor);
      const nextCost = current.cost + distance(currentPoint, neighbor);

      if (nextCost < (costs.get(neighborKey) ?? Infinity)) {
        costs.set(neighborKey, nextCost);
        previousByKey.set(neighborKey, current.key);
        queue.push(neighborKey, nextCost);
      }
    }
  }

  if (!previousByKey.has(endKey) && startKey !== endKey) {
    return simplifyRoute(fallbackRoute(start, end, obstacles));
  }

  const routedPoints: RoutePoint[] = [];
  let currentKey: string | undefined = endKey;

  while (currentKey) {
    const point = points.get(currentKey);

    if (point) {
      routedPoints.unshift(point);
    }

    if (currentKey === startKey) {
      break;
    }

    currentKey = previousByKey.get(currentKey);
  }

  return simplifyRoute([start, ...routedPoints, end]);
}

const pointToward = (from: RoutePoint, to: RoutePoint, amount: number): RoutePoint => {
  const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);

  if (segmentLength === 0) {
    return from;
  }

  return {
    x: from.x + ((to.x - from.x) / segmentLength) * amount,
    y: from.y + ((to.y - from.y) / segmentLength) * amount
  };
};

export function routeToPath(points: RoutePoint[]) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];

    if (previous.x === current.x && current.x === next.x) {
      continue;
    }

    if (previous.y === current.y && current.y === next.y) {
      continue;
    }

    const radius = Math.min(
      CORNER_RADIUS,
      Math.hypot(current.x - previous.x, current.y - previous.y) / 2,
      Math.hypot(next.x - current.x, next.y - current.y) / 2
    );
    const cornerStart = pointToward(current, previous, radius);
    const cornerEnd = pointToward(current, next, radius);

    path += ` L ${cornerStart.x} ${cornerStart.y} Q ${current.x} ${current.y} ${cornerEnd.x} ${cornerEnd.y}`;
  }

  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;

  return path;
}

export function routeSelfEdge(source: RoutePoint, target: RoutePoint) {
  const chord = Math.max(12, Math.abs(target.x - source.x));
  const radius = Math.max(42, chord * 1.45);
  const centerX = (source.x + target.x) / 2;
  const centerY = source.y - Math.sqrt(Math.max(1, radius ** 2 - (chord / 2) ** 2));
  const top = { x: centerX, y: centerY - radius };
  const path = `M ${source.x} ${source.y} A ${radius} ${radius} 0 0 1 ${top.x} ${top.y} A ${radius} ${radius} 0 0 1 ${target.x} ${target.y}`;

  return {
    path,
    labelX: centerX,
    labelY: centerY
  };
}
