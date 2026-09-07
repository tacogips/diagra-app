import type { Box, Vec } from "./geometry.ts";

const EPSILON = 1e-7;
const TURN_PENALTY = 12;

type Direction = "h" | "v";

interface QueueItem {
  readonly key: string;
  readonly point: Vec;
  readonly direction: Direction;
  readonly cost: number;
}

function compactRoute(points: readonly Vec[]): readonly Vec[] {
  const distinct = points.filter(
    (point, index) =>
      index === 0 ||
      Math.abs(point.x - (points[index - 1]?.x ?? point.x)) > EPSILON ||
      Math.abs(point.y - (points[index - 1]?.y ?? point.y)) > EPSILON,
  );
  return distinct.filter((point, index) => {
    if (index === 0 || index === distinct.length - 1) return true;
    const previous = distinct[index - 1] as Vec;
    const next = distinct[index + 1] as Vec;
    return !(
      (Math.abs(previous.x - point.x) <= EPSILON &&
        Math.abs(point.x - next.x) <= EPSILON) ||
      (Math.abs(previous.y - point.y) <= EPSILON &&
        Math.abs(point.y - next.y) <= EPSILON)
    );
  });
}

function inside(box: Box, point: Vec): boolean {
  return (
    point.x > box.x + EPSILON &&
    point.x < box.x + box.width - EPSILON &&
    point.y > box.y + EPSILON &&
    point.y < box.y + box.height - EPSILON
  );
}

function segmentBlocked(
  from: Vec,
  to: Vec,
  obstacles: readonly Box[],
): boolean {
  if (Math.abs(from.y - to.y) <= EPSILON) {
    const left = Math.min(from.x, to.x);
    const right = Math.max(from.x, to.x);
    return obstacles.some(
      (box) =>
        from.y > box.y + EPSILON &&
        from.y < box.y + box.height - EPSILON &&
        right > box.x + EPSILON &&
        left < box.x + box.width - EPSILON,
    );
  }
  if (Math.abs(from.x - to.x) <= EPSILON) {
    const top = Math.min(from.y, to.y);
    const bottom = Math.max(from.y, to.y);
    return obstacles.some(
      (box) =>
        from.x > box.x + EPSILON &&
        from.x < box.x + box.width - EPSILON &&
        bottom > box.y + EPSILON &&
        top < box.y + box.height - EPSILON,
    );
  }
  return true;
}

function routeBlocked(
  route: readonly Vec[],
  obstacles: readonly Box[],
): boolean {
  return route
    .slice(1)
    .some((point, index) =>
      segmentBlocked(route[index] as Vec, point, obstacles),
    );
}

function sortedUnique(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function stateKey(
  xIndex: number,
  yIndex: number,
  direction: Direction,
): string {
  return `${xIndex}:${yIndex}:${direction}`;
}

function pushQueue(queue: QueueItem[], item: QueueItem): void {
  queue.push(item);
  let index = queue.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if ((queue[parent]?.cost ?? Number.POSITIVE_INFINITY) <= item.cost) break;
    queue[index] = queue[parent] as QueueItem;
    index = parent;
  }
  queue[index] = item;
}

function popQueue(queue: QueueItem[]): QueueItem | undefined {
  const first = queue[0];
  const last = queue.pop();
  if (!first || !last || queue.length === 0) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= queue.length) break;
    const child =
      right < queue.length &&
      (queue[right]?.cost ?? Number.POSITIVE_INFINITY) <
        (queue[left]?.cost ?? Number.POSITIVE_INFINITY)
        ? right
        : left;
    if ((queue[child]?.cost ?? Number.POSITIVE_INFINITY) >= last.cost) break;
    queue[index] = queue[child] as QueueItem;
    index = child;
  }
  queue[index] = last;
  return first;
}

function gridRoute(
  start: Vec,
  end: Vec,
  preferred: readonly Vec[],
  obstacles: readonly Box[],
  endpointDirection: Direction,
): readonly Vec[] | null {
  const xs = sortedUnique([
    start.x,
    end.x,
    ...preferred.map((point) => point.x),
    ...obstacles.flatMap((box) => [box.x, box.x + box.width]),
  ]);
  const ys = sortedUnique([
    start.y,
    end.y,
    ...preferred.map((point) => point.y),
    ...obstacles.flatMap((box) => [box.y, box.y + box.height]),
  ]);
  const startX = xs.indexOf(start.x);
  const startY = ys.indexOf(start.y);
  const endX = xs.indexOf(end.x);
  const endY = ys.indexOf(end.y);
  if (startX < 0 || startY < 0 || endX < 0 || endY < 0) return null;

  const queue: QueueItem[] = [];
  const costs = new Map<string, number>();
  const previous = new Map<string, string>();
  const points = new Map<string, Vec>();
  const startKey = stateKey(startX, startY, endpointDirection);
  costs.set(startKey, 0);
  points.set(startKey, start);
  pushQueue(queue, {
    key: startKey,
    point: start,
    direction: endpointDirection,
    cost: 0,
  });

  let goalKey: string | null = null;
  while (queue.length > 0) {
    const current = popQueue(queue);
    if (!current || current.cost !== costs.get(current.key)) continue;
    const [rawX, rawY] = current.key.split(":");
    const xIndex = Number(rawX);
    const yIndex = Number(rawY);
    if (
      xIndex === endX &&
      yIndex === endY &&
      current.direction === endpointDirection
    ) {
      goalKey = current.key;
      break;
    }

    const candidates: Array<{
      xIndex: number;
      yIndex: number;
      direction: Direction;
    }> = [];
    for (const step of [-1, 1] as const) {
      for (
        let next = xIndex + step;
        next >= 0 && next < xs.length;
        next += step
      ) {
        const point = { x: xs[next] as number, y: ys[yIndex] as number };
        if (obstacles.some((box) => inside(box, point))) continue;
        if (segmentBlocked(current.point, point, obstacles)) break;
        candidates.push({ xIndex: next, yIndex, direction: "h" });
        break;
      }
      for (
        let next = yIndex + step;
        next >= 0 && next < ys.length;
        next += step
      ) {
        const point = { x: xs[xIndex] as number, y: ys[next] as number };
        if (obstacles.some((box) => inside(box, point))) continue;
        if (segmentBlocked(current.point, point, obstacles)) break;
        candidates.push({ xIndex, yIndex: next, direction: "v" });
        break;
      }
    }

    for (const candidate of candidates) {
      if (current.key === startKey && candidate.direction !== endpointDirection)
        continue;
      const point = {
        x: xs[candidate.xIndex] as number,
        y: ys[candidate.yIndex] as number,
      };
      const distance =
        Math.abs(point.x - current.point.x) +
        Math.abs(point.y - current.point.y);
      const cost =
        current.cost +
        distance +
        (candidate.direction === current.direction ? 0 : TURN_PENALTY);
      const key = stateKey(
        candidate.xIndex,
        candidate.yIndex,
        candidate.direction,
      );
      if (cost >= (costs.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      costs.set(key, cost);
      previous.set(key, current.key);
      points.set(key, point);
      pushQueue(queue, { key, point, direction: candidate.direction, cost });
    }
  }
  if (!goalKey) return null;
  const route: Vec[] = [];
  let key: string | undefined = goalKey;
  while (key) {
    route.push(points.get(key) as Vec);
    key = previous.get(key);
  }
  return compactRoute(route.reverse());
}

/**
 * Find a deterministic rectilinear route that keeps the supplied clearance
 * rectangles out of every segment. The preferred route is returned byte-for-
 * byte when it is already clear, preserving the user's bend position.
 */
export function avoidOrthogonalObstacles(
  preferred: readonly Vec[],
  obstacles: readonly Box[],
  endpointDirection: Direction,
): readonly Vec[] {
  if (preferred.length < 2) return preferred;
  const start = preferred[0] as Vec;
  const end = preferred.at(-1) as Vec;
  const usable = obstacles.filter(
    (box) => !inside(box, start) && !inside(box, end),
  );
  if (!routeBlocked(preferred, usable)) return preferred;
  let active = usable.filter((box) => routeBlocked(preferred, [box]));
  let route: readonly Vec[] | null = null;
  for (let attempt = 0; attempt <= usable.length; attempt += 1) {
    route = gridRoute(start, end, preferred, active, endpointDirection);
    if (!route) return preferred;
    const added = usable.filter(
      (box) =>
        !active.includes(box) && routeBlocked(route as readonly Vec[], [box]),
    );
    if (added.length === 0) return route;
    active = [...active, ...added];
  }
  return route ?? preferred;
}
