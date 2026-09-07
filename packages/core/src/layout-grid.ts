import type { AxisLayoutGrid, FrameSemantic, LayoutGrid } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { newElementId } from "./ids.ts";

export const MAX_LAYOUT_GRIDS = 8;

export type LayoutGridKind = LayoutGrid["kind"];

export interface LayoutGridBand {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function defaultLayoutGrid(
  kind: LayoutGridKind,
  id: string,
): LayoutGrid {
  return kind === "grid"
    ? {
        id,
        kind,
        size: 8,
        color: "#3b82f6",
        opacity: 0.2,
      }
    : {
        id,
        kind,
        count: kind === "columns" ? 4 : 8,
        gutter: 16,
        margin: 16,
        color: "#ef4444",
        opacity: 0.12,
      };
}

export function isValidLayoutGrid(grid: LayoutGrid): boolean {
  if (
    !/^#[\da-f]{6}$/i.test(grid.color) ||
    !Number.isFinite(grid.opacity) ||
    grid.opacity < 0 ||
    grid.opacity > 1
  )
    return false;
  if (grid.kind === "grid") return Number.isFinite(grid.size) && grid.size >= 1;
  return (
    Number.isInteger(grid.count) &&
    grid.count >= 1 &&
    grid.count <= 24 &&
    Number.isFinite(grid.gutter) &&
    grid.gutter >= 0 &&
    Number.isFinite(grid.margin) &&
    grid.margin >= 0
  );
}

function editableFrame(editor: Editor, id: string) {
  const element = editor.store.get(id);
  return element?.type === "frame" &&
    !editor.createShapeContext().isLocked?.(id)
    ? element
    : null;
}

function writeGrids(
  editor: Editor,
  id: string,
  semantic: FrameSemantic,
  grids: readonly LayoutGrid[],
): boolean {
  if (grids.length > MAX_LAYOUT_GRIDS) return false;
  const ids = new Set<string>();
  for (const grid of grids) {
    if (!grid.id || ids.has(grid.id) || !isValidLayoutGrid(grid)) return false;
    ids.add(grid.id);
  }
  const { layoutGrids: _old, ...rest } = semantic;
  const next: FrameSemantic = {
    ...rest,
    ...(grids.length ? { layoutGrids: grids } : {}),
  };
  if (JSON.stringify(semantic) === JSON.stringify(next)) return false;
  editor.apply([{ type: "updateSemantic", id, semantic: next }]);
  return true;
}

export function addLayoutGrid(
  editor: Editor,
  frameId: string,
  kind: LayoutGridKind,
  id: string = newElementId(),
): boolean {
  const frame = editableFrame(editor, frameId);
  if (!frame) return false;
  const semantic = frame.semantic as FrameSemantic;
  const grids = Array.isArray(semantic.layoutGrids) ? semantic.layoutGrids : [];
  if (grids.length >= MAX_LAYOUT_GRIDS) return false;
  return writeGrids(editor, frameId, semantic, [
    ...grids,
    defaultLayoutGrid(kind, id),
  ]);
}

export function updateLayoutGrid(
  editor: Editor,
  frameId: string,
  index: number,
  grid: LayoutGrid,
): boolean {
  const frame = editableFrame(editor, frameId);
  if (!frame || !Number.isInteger(index) || !isValidLayoutGrid(grid))
    return false;
  const semantic = frame.semantic as FrameSemantic;
  const grids = Array.isArray(semantic.layoutGrids)
    ? [...semantic.layoutGrids]
    : [];
  if (index < 0 || index >= grids.length) return false;
  grids[index] = grid;
  return writeGrids(editor, frameId, semantic, grids);
}

export function removeLayoutGrid(
  editor: Editor,
  frameId: string,
  index: number,
): boolean {
  const frame = editableFrame(editor, frameId);
  if (!frame || !Number.isInteger(index)) return false;
  const semantic = frame.semantic as FrameSemantic;
  const grids = Array.isArray(semantic.layoutGrids) ? semantic.layoutGrids : [];
  if (index < 0 || index >= grids.length) return false;
  return writeGrids(
    editor,
    frameId,
    semantic,
    grids.filter((_, at) => at !== index),
  );
}

/** Equal-width stretch bands for column and row overlays. */
export function layoutGridBands(
  grid: AxisLayoutGrid,
  width: number,
  height: number,
): readonly LayoutGridBand[] {
  if (
    !isValidLayoutGrid(grid) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return [];
  const extent = grid.kind === "columns" ? width : height;
  const available = extent - grid.margin * 2 - grid.gutter * (grid.count - 1);
  if (available <= 0) return [];
  const size = available / grid.count;
  return Array.from({ length: grid.count }, (_, index) => {
    const offset = grid.margin + index * (size + grid.gutter);
    return grid.kind === "columns"
      ? { x: offset, y: 0, width: size, height }
      : { x: 0, y: offset, width, height: size };
  });
}
