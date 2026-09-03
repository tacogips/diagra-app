// Snapping: nudging a gesture's delta so edges and centres line up.
//
// Pure geometry over bounds, so it works for every ShapeUtil and needs no
// DOM to test. Snapping never writes to the document: the gesture asks
// "given where the pointer wants to put this box, where should it go?",
// applies the corrected delta, and draws the guides this returns.
//
// Object snapping wins over grid snapping on an axis, and edges win over
// centres on a tie, which is the behaviour draw.io and Miro users expect:
// a box dragged near a neighbour lands flush with it, not on the grid line
// a few units away.

import type { Box } from "./geometry.ts";

export interface SnapGuide {
  readonly axis: "x" | "y";
  /** The page-space coordinate the guide is drawn at. */
  readonly at: number;
  /** Extent of the guide along the other axis. */
  readonly from: number;
  readonly to: number;
}

export interface SnapOptions {
  /** Maximum page-space distance an object snap may pull, per axis. */
  readonly threshold: number;
  /** Grid spacing in page units; omitted means no grid snapping. */
  readonly grid?: number;
}

export interface SnapResult {
  /** Correction to add to the gesture's delta. */
  readonly dx: number;
  readonly dy: number;
  readonly guides: readonly SnapGuide[];
}

export const NO_SNAP: SnapResult = { dx: 0, dy: 0, guides: [] };

/** Which edges of a box a resize handle moves. */
export interface ResizeEdges {
  readonly left?: boolean;
  readonly right?: boolean;
  readonly top?: boolean;
  readonly bottom?: boolean;
}

interface Line {
  readonly at: number;
  readonly edge: boolean;
}

function xLines(box: Box): readonly Line[] {
  return [
    { at: box.x, edge: true },
    { at: box.x + box.width / 2, edge: false },
    { at: box.x + box.width, edge: true },
  ];
}

function yLines(box: Box): readonly Line[] {
  return [
    { at: box.y, edge: true },
    { at: box.y + box.height / 2, edge: false },
    { at: box.y + box.height, edge: true },
  ];
}

interface Match {
  readonly delta: number;
  readonly at: number;
  readonly candidate: Box;
}

/**
 * The closest candidate line within `threshold` of any moving line, or
 * `null`. Smaller distance wins; on an exact tie an edge-to-edge match
 * beats a centre match.
 */
function bestMatch(
  moving: readonly Line[],
  candidates: readonly Box[],
  lines: (box: Box) => readonly Line[],
  threshold: number,
): Match | null {
  let best: (Match & { readonly edge: boolean }) | null = null;
  for (const candidate of candidates) {
    for (const target of lines(candidate)) {
      for (const source of moving) {
        const delta = target.at - source.at;
        const distance = Math.abs(delta);
        if (distance > threshold) {
          continue;
        }
        const edge = target.edge && source.edge;
        if (
          best === null ||
          distance < Math.abs(best.delta) ||
          (distance === Math.abs(best.delta) && edge && !best.edge)
        ) {
          best = { delta, at: target.at, candidate, edge };
        }
      }
    }
  }
  return best;
}

function gridDelta(value: number, grid: number): number {
  return Math.round(value / grid) * grid - value;
}

function guideFor(
  axis: "x" | "y",
  at: number,
  moved: Box,
  candidate: Box,
): SnapGuide {
  if (axis === "x") {
    return {
      axis,
      at,
      from: Math.min(moved.y, candidate.y),
      to: Math.max(moved.y + moved.height, candidate.y + candidate.height),
    };
  }
  return {
    axis,
    at,
    from: Math.min(moved.x, candidate.x),
    to: Math.max(moved.x + moved.width, candidate.x + candidate.width),
  };
}

/**
 * Snap a box being translated. `moving` is where the gesture wants the box
 * (already offset by the pointer delta); the result's `dx`/`dy` is the
 * extra correction that lines it up.
 */
export function snapTranslate(
  moving: Box,
  candidates: readonly Box[],
  options: SnapOptions,
): SnapResult {
  const xMatch = bestMatch(
    xLines(moving),
    candidates,
    xLines,
    options.threshold,
  );
  const yMatch = bestMatch(
    yLines(moving),
    candidates,
    yLines,
    options.threshold,
  );

  let dx = xMatch?.delta ?? 0;
  let dy = yMatch?.delta ?? 0;
  if (options.grid !== undefined && options.grid > 0) {
    if (xMatch === null) {
      dx = gridDelta(moving.x, options.grid);
    }
    if (yMatch === null) {
      dy = gridDelta(moving.y, options.grid);
    }
  }

  const moved: Box = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: SnapGuide[] = [];
  if (xMatch) {
    guides.push(guideFor("x", xMatch.at, moved, xMatch.candidate));
  }
  if (yMatch) {
    guides.push(guideFor("y", yMatch.at, moved, yMatch.candidate));
  }
  return { dx, dy, guides };
}

/**
 * Snap the edges a resize handle owns. Only those edges move; the box that
 * comes back has the opposite edges exactly where `box` had them.
 */
export function snapResize(
  box: Box,
  edges: ResizeEdges,
  candidates: readonly Box[],
  options: SnapOptions,
): { readonly box: Box; readonly guides: readonly SnapGuide[] } {
  let left = box.x;
  let right = box.x + box.width;
  let top = box.y;
  let bottom = box.y + box.height;
  const guides: SnapGuide[] = [];
  const grid =
    options.grid !== undefined && options.grid > 0 ? options.grid : 0;

  const snapEdge = (
    value: number,
    lines: (candidate: Box) => readonly Line[],
    axis: "x" | "y",
  ): number => {
    const match = bestMatch(
      [{ at: value, edge: true }],
      candidates,
      lines,
      options.threshold,
    );
    if (match) {
      guides.push(guideFor(axis, match.at, box, match.candidate));
      return match.at;
    }
    return grid > 0 ? value + gridDelta(value, grid) : value;
  };

  if (edges.left) {
    left = snapEdge(left, xLines, "x");
  }
  if (edges.right) {
    right = snapEdge(right, xLines, "x");
  }
  if (edges.top) {
    top = snapEdge(top, yLines, "y");
  }
  if (edges.bottom) {
    bottom = snapEdge(bottom, yLines, "y");
  }

  return {
    box: { x: left, y: top, width: right - left, height: bottom - top },
    guides,
  };
}
