// Pure geometry for "Tidy layout" and "Remove overlaps".
//
// Nothing here knows about documents: callers pass boxes and directed edges
// and get positions back. The layered layout is a compact Sugiyama variant:
// break cycles, assign layers by longest path, reduce crossings with
// barycenter sweeps, then place each layer with an isotonic (pool adjacent
// violators) solve that keeps the order, never overlaps, and pulls each box
// as close as possible to the boxes it is connected to. The layered layout
// depends only on ids, sizes and edges -- never on current positions -- so
// tidying an already tidy diagram changes nothing.

export type LayoutDirection = "LR" | "TB";

export interface LayoutNode {
  readonly id: string;
  /** Current position; only overlap separation reads it. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A directed dependency: `from` is placed in an earlier layer than `to`. */
export interface LayoutEdge {
  readonly from: string;
  readonly to: string;
}

export interface LayeredLayoutOptions {
  readonly direction?: LayoutDirection;
  /** Space between boxes in the same layer. */
  readonly nodeGap?: number;
  /** Space between layers. */
  readonly layerGap?: number;
  /** Space between packed components and unconnected boxes. */
  readonly componentGap?: number;
  /** Preferred width / height of the packed result. */
  readonly aspectRatio?: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

const DEFAULTS = {
  direction: "LR" as LayoutDirection,
  nodeGap: 40,
  layerGap: 120,
  componentGap: 120,
  aspectRatio: 16 / 10,
};

const SWEEPS = 8;

interface Placed {
  readonly id: string;
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Reading order: top to bottom, then left to right, then id. */
/** Tidy layout orders by id only, so it is a pure function of the graph. */
function idOrder(a: LayoutNode, b: LayoutNode): number {
  return compareText(a.id, b.id);
}

function readingOrder(a: LayoutNode, b: LayoutNode): number {
  return a.y - b.y || a.x - b.x || compareText(a.id, b.id);
}

/**
 * Minimise sum((p[i] - desired[i])^2) subject to p[i+1] >= p[i] + size[i] + gap.
 * Substituting q[i] = p[i] - offset[i] turns this into isotonic regression,
 * which pool-adjacent-violators solves exactly in linear time.
 */
export function placeInOrder(
  desired: readonly number[],
  sizes: readonly number[],
  gap: number,
): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (let i = 0; i < sizes.length; i += 1) {
    offsets.push(offset);
    offset += (sizes[i] as number) + gap;
  }
  const blocks: { sum: number; count: number }[] = [];
  for (let i = 0; i < desired.length; i += 1) {
    blocks.push({
      sum: (desired[i] as number) - (offsets[i] as number),
      count: 1,
    });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1] as { sum: number; count: number };
      const previous = blocks[blocks.length - 2] as {
        sum: number;
        count: number;
      };
      if (previous.sum / previous.count <= last.sum / last.count) break;
      previous.sum += last.sum;
      previous.count += last.count;
      blocks.pop();
    }
  }
  const out: number[] = [];
  for (const block of blocks) {
    const value = block.sum / block.count;
    for (let k = 0; k < block.count; k += 1)
      out.push(value + (offsets[out.length] as number));
  }
  return out;
}

function components(
  nodes: readonly LayoutNode[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): LayoutNode[][] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const out: LayoutNode[][] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const members: LayoutNode[] = [];
    const stack = [node.id];
    seen.add(node.id);
    while (stack.length) {
      const id = stack.pop() as string;
      members.push(byId.get(id) as LayoutNode);
      for (const next of adjacency.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    out.push(members.sort(idOrder));
  }
  return out;
}

/** Layer index per node: cycles broken by DFS order, longest path from sources. */
function assignLayers(
  members: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
): Map<string, number> {
  const ids = new Set(members.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }
  // Keep only edges that do not close a cycle (DFS back edges are dropped).
  const state = new Map<string, 1 | 2>();
  const acyclic: LayoutEdge[] = [];
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const next of outgoing.get(id) ?? []) {
      const seen = state.get(next);
      if (seen === 1) continue;
      acyclic.push({ from: id, to: next });
      if (seen === undefined) visit(next);
    }
    state.set(id, 2);
  };
  for (const node of members) if (!state.has(node.id)) visit(node.id);

  const incoming = new Map<string, string[]>();
  const forward = new Map<string, string[]>();
  for (const edge of acyclic) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
    forward.set(edge.from, [...(forward.get(edge.from) ?? []), edge.to]);
  }
  const layer = new Map<string, number>();
  const depth = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    layer.set(id, 0);
    let value = 0;
    for (const parent of incoming.get(id) ?? [])
      value = Math.max(value, depth(parent) + 1);
    layer.set(id, value);
    return value;
  };
  for (const node of members) depth(node.id);
  // A source sits just before its nearest child instead of at layer 0, so a
  // leaf lookup table does not drag a long edge across the whole diagram.
  for (const node of members) {
    if (incoming.get(node.id)?.length) continue;
    const children = forward.get(node.id) ?? [];
    if (!children.length) continue;
    const nearest = Math.min(...children.map((child) => layer.get(child) ?? 0));
    layer.set(node.id, Math.max(layer.get(node.id) ?? 0, nearest - 1));
  }
  return layer;
}

function layoutComponent(
  members: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  neighbours: ReadonlyMap<string, ReadonlySet<string>>,
  options: Required<LayeredLayoutOptions>,
): Placed[] {
  const horizontal = options.direction === "LR";
  const along = (node: LayoutNode): number =>
    horizontal ? node.width : node.height;
  const across = (node: LayoutNode): number =>
    horizontal ? node.height : node.width;
  const layerOf = assignLayers(members, edges);
  const layerCount =
    Math.max(...members.map((node) => layerOf.get(node.id) ?? 0)) + 1;
  const layers: LayoutNode[][] = Array.from({ length: layerCount }, () => []);
  for (const node of members) layers[layerOf.get(node.id) ?? 0]?.push(node);
  for (const layer of layers) layer.sort(idOrder);

  // Crossing reduction: order each layer by the mean relative rank of its
  // neighbours in the other layers.
  const rank = new Map<string, number>();
  const refreshRanks = (): void => {
    for (const layer of layers)
      layer.forEach((node, index) =>
        rank.set(node.id, layer.length > 1 ? index / (layer.length - 1) : 0.5),
      );
  };
  refreshRanks();
  for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
    const downward = sweep % 2 === 0;
    const order = downward ? layers : [...layers].reverse();
    for (const layer of order) {
      const own = layerOf.get(layer[0]?.id ?? "") ?? 0;
      const keys = new Map<string, number>();
      for (const node of layer) {
        const related = [...(neighbours.get(node.id) ?? [])].filter((id) => {
          const other = layerOf.get(id) ?? own;
          return downward ? other < own : other > own;
        });
        keys.set(
          node.id,
          related.length
            ? related.reduce((sum, id) => sum + (rank.get(id) ?? 0), 0) /
                related.length
            : (rank.get(node.id) ?? 0),
        );
      }
      layer.sort(
        (a, b) =>
          (keys.get(a.id) ?? 0) - (keys.get(b.id) ?? 0) ||
          (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
      );
      refreshRanks();
    }
  }

  // Layer positions along the flow.
  const layerStart: number[] = [];
  let cursor = 0;
  for (const layer of layers) {
    layerStart.push(cursor);
    cursor += Math.max(0, ...layer.map(along)) + options.layerGap;
  }

  // Positions across the flow: stack, then pull towards neighbours.
  const position = new Map<string, number>();
  for (const layer of layers) {
    let offset = 0;
    for (const node of layer) {
      position.set(node.id, offset);
      offset += across(node) + options.nodeGap;
    }
  }
  const centre = (node: LayoutNode): number =>
    (position.get(node.id) ?? 0) + across(node) / 2;
  const byId = new Map(members.map((node) => [node.id, node]));
  const pass = (
    layerOrder: readonly LayoutNode[][],
    side: -1 | 0 | 1,
  ): void => {
    for (const layer of layerOrder) {
      const own = layerOf.get(layer[0]?.id ?? "") ?? 0;
      const desired = layer.map((node) => {
        const related = [...(neighbours.get(node.id) ?? [])].filter((id) => {
          const other = layerOf.get(id) ?? own;
          return side === 0 ? other !== own : Math.sign(other - own) === side;
        });
        if (!related.length) return position.get(node.id) ?? 0;
        const mean =
          related.reduce(
            (sum, id) => sum + centre(byId.get(id) as LayoutNode),
            0,
          ) / related.length;
        return mean - across(node) / 2;
      });
      const placed = placeInOrder(desired, layer.map(across), options.nodeGap);
      layer.forEach((node, index) =>
        position.set(node.id, placed[index] as number),
      );
    }
  };
  pass(layers, -1);
  pass([...layers].reverse(), 1);
  pass(layers, 0);

  const minAcross = Math.min(
    ...members.map((node) => position.get(node.id) ?? 0),
  );
  return members.map((node) => {
    const flow = layerStart[layerOf.get(node.id) ?? 0] as number;
    const cross = (position.get(node.id) ?? 0) - minAcross;
    return {
      id: node.id,
      x: horizontal ? flow : cross,
      y: horizontal ? cross : flow,
      width: node.width,
      height: node.height,
    };
  });
}

function extentOf(placed: readonly Placed[]): {
  width: number;
  height: number;
} {
  let width = 0;
  let height = 0;
  for (const box of placed) {
    width = Math.max(width, box.x + box.width);
    height = Math.max(height, box.y + box.height);
  }
  return { width, height };
}

/**
 * Lay out boxes connected by directed edges. Positions are relative to
 * (0, 0); connected groups are laid out separately and shelf-packed with
 * unconnected boxes towards `aspectRatio`.
 */
export function layeredLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  layoutOptions: LayeredLayoutOptions = {},
): Map<string, Point> {
  const options: Required<LayeredLayoutOptions> = {
    ...DEFAULTS,
    ...Object.fromEntries(
      Object.entries(layoutOptions).filter(([, value]) => value !== undefined),
    ),
  } as Required<LayeredLayoutOptions>;
  const ids = new Set(nodes.map((node) => node.id));
  const unique = new Map<string, LayoutEdge>();
  for (const edge of edges) {
    if (edge.from === edge.to || !ids.has(edge.from) || !ids.has(edge.to))
      continue;
    unique.set(`${edge.from}\u0000${edge.to}`, edge);
  }
  const directed = [...unique.values()].sort(
    (a, b) => compareText(a.from, b.from) || compareText(a.to, b.to),
  );
  const neighbours = new Map<string, Set<string>>();
  for (const edge of directed) {
    neighbours.set(
      edge.from,
      (neighbours.get(edge.from) ?? new Set()).add(edge.to),
    );
    neighbours.set(
      edge.to,
      (neighbours.get(edge.to) ?? new Set()).add(edge.from),
    );
  }
  const ordered = [...nodes].sort(idOrder);
  const groups = components(ordered, neighbours);
  const connected = groups.filter((group) => group.length > 1);
  const single = groups.filter((group) => group.length === 1).flat();

  const blocks: { placed: Placed[]; width: number; height: number }[] = [];
  for (const group of connected) {
    const placed = layoutComponent(group, directed, neighbours, options);
    blocks.push({ placed, ...extentOf(placed) });
  }
  blocks.sort(
    (a, b) =>
      b.placed.length - a.placed.length ||
      compareText(a.placed[0]?.id ?? "", b.placed[0]?.id ?? ""),
  );
  for (const node of single)
    blocks.push({
      placed: [
        { id: node.id, x: 0, y: 0, width: node.width, height: node.height },
      ],
      width: node.width,
      height: node.height,
    });

  const area = blocks.reduce(
    (sum, block) =>
      sum +
      (block.width + options.componentGap) *
        (block.height + options.componentGap),
    0,
  );
  const rowWidth = Math.max(
    ...blocks.map((block) => block.width),
    Math.sqrt(area * options.aspectRatio),
  );
  const out = new Map<string, Point>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const block of blocks) {
    if (x > 0 && x + block.width > rowWidth) {
      x = 0;
      y += rowHeight + options.componentGap;
      rowHeight = 0;
    }
    // Whole units: composing these with integer anchors stays exact.
    for (const box of block.placed)
      out.set(box.id, {
        x: Math.round(x + box.x),
        y: Math.round(y + box.y),
      });
    x += block.width + options.componentGap;
    rowHeight = Math.max(rowHeight, block.height);
  }
  return out;
}

export interface OverlapBox extends LayoutNode {
  /** Fixed boxes are obstacles that never move. */
  readonly fixed?: boolean;
}

/**
 * Push boxes apart until no two are closer than `gap`, moving each along the
 * axis that needs the smaller displacement. Earlier boxes in reading order
 * stay put and later ones move, so the result is deterministic and close to
 * the authored arrangement. Returns positions for every box.
 */
export function separateOverlaps(
  boxes: readonly OverlapBox[],
  gap = 24,
  maxRounds = 400,
): Map<string, Point> {
  const items = [...boxes].sort(readingOrder).map((box) => ({
    id: box.id,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    fixed: box.fixed === true,
  }));
  for (let round = 0; round < maxRounds; round += 1) {
    let moved = false;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i] as (typeof items)[number];
        const b = items[j] as (typeof items)[number];
        if (a.fixed && b.fixed) continue;
        const pushRight = a.x + a.width + gap - b.x;
        const pushLeft = b.x + b.width + gap - a.x;
        const pushDown = a.y + a.height + gap - b.y;
        const pushUp = b.y + b.height + gap - a.y;
        if (pushRight <= 0 || pushLeft <= 0 || pushDown <= 0 || pushUp <= 0)
          continue;
        const mover = b.fixed ? a : b;
        const sign = mover === b ? 1 : -1;
        const centreDx = b.x + b.width / 2 - (a.x + a.width / 2);
        const centreDy = b.y + b.height / 2 - (a.y + a.height / 2);
        const dx = centreDx >= 0 ? pushRight : -pushLeft;
        const dy = centreDy >= 0 ? pushDown : -pushUp;
        if (Math.abs(dx) < Math.abs(dy)) mover.x += sign * dx;
        else mover.y += sign * dy;
        moved = true;
      }
    }
    if (!moved) break;
  }
  settle(items, gap);
  return new Map(items.map((item) => [item.id, { x: item.x, y: item.y }]));
}

interface SettleItem {
  readonly id: string;
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
  readonly fixed: boolean;
}

/** Closer than `gap` on both axes, i.e. what `separateOverlaps` resolves. */
function crowds(a: SettleItem, b: SettleItem, gap: number): boolean {
  return (
    a.x + a.width + gap > b.x &&
    b.x + b.width + gap > a.x &&
    a.y + a.height + gap > b.y &&
    b.y + b.height + gap > a.y
  );
}

/**
 * Guarantee the result: pairwise pushing can oscillate when a box is wedged
 * between fixed ones. Fixed boxes are placed first, then every movable box in
 * reading order keeps its position if it is clear, or else takes the nearest
 * clear slot beside an already placed box (falling back to just right of
 * everything, which is always clear).
 */
function settle(items: SettleItem[], gap: number): void {
  const placed: SettleItem[] = items.filter((item) => item.fixed);
  for (const item of items) {
    if (item.fixed) continue;
    const clear = (x: number, y: number): boolean =>
      !placed.some((other) => crowds({ ...item, x, y }, other, gap));
    if (!clear(item.x, item.y)) {
      const candidates: [number, number][] = [];
      for (const other of placed) {
        candidates.push(
          [item.x, other.y + other.height + gap],
          [other.x + other.width + gap, item.y],
          [item.x, other.y - item.height - gap],
          [other.x - item.width - gap, item.y],
        );
      }
      let best: [number, number] = [
        Math.max(...placed.map((other) => other.x + other.width)) + gap,
        item.y,
      ];
      let bestCost = Math.abs(best[0] - item.x);
      for (const [x, y] of candidates) {
        const cost = Math.abs(x - item.x) + Math.abs(y - item.y);
        if (cost < bestCost && clear(x, y)) {
          best = [x, y];
          bestCost = cost;
        }
      }
      item.x = best[0];
      item.y = best[1];
    }
    placed.push(item);
  }
}
