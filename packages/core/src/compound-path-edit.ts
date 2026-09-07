import type {
  Element,
  FreehandPoint,
  PathContour,
  PathSemantic,
} from "@diagra/ir";
import type { Command } from "./commands.ts";
import { boxCenter, rotatePoint, type Vec } from "./geometry.ts";
import { compoundPathGeometry } from "./shapes/compound-path.ts";
import { moveStrokeAnchor } from "./stroke-edit.ts";

function mapPoint(
  point: FreehandPoint,
  transform: (point: Vec) => Vec,
): FreehandPoint {
  return {
    ...point,
    ...transform(point),
    ...(point.controlIn ? { controlIn: transform(point.controlIn) } : {}),
    ...(point.controlOut ? { controlOut: transform(point.controlOut) } : {}),
  };
}

export function pathWorldContours(element: Element): FreehandPoint[][] {
  const geometry = compoundPathGeometry(element);
  if (!geometry) return [];
  const center = boxCenter(geometry.box);
  const rotation = element.visual.rotation ?? 0;
  return geometry.contours.map((contour) =>
    contour.map((point) =>
      mapPoint(point, (local) => {
        const page = {
          x: local.x + geometry.box.x,
          y: local.y + geometry.box.y,
        };
        return rotation ? rotatePoint(page, center, rotation) : page;
      }),
    ),
  );
}

/** Rebase edited world-space path contours while retaining layer rotation. */
export function planPathWorldContours(
  element: Element,
  contours: readonly (readonly FreehandPoint[])[],
): Command[] {
  if (
    element.type !== "draw.path" ||
    !contours.length ||
    contours.length > 1024 ||
    contours.some((contour) => contour.length < 3) ||
    contours.reduce((total, contour) => total + contour.length, 0) > 20000
  )
    return [];
  const current = compoundPathGeometry(element);
  if (!current) return [];
  const rotation = element.visual.rotation ?? 0;
  const center = boxCenter(current.box);
  const local = contours.map((contour) =>
    contour.map((point) =>
      mapPoint(point, (world) =>
        rotation ? rotatePoint(world, center, -rotation) : world,
      ),
    ),
  );
  const samples = local.flatMap((contour) =>
    contour.flatMap((point) =>
      [point, point.controlIn, point.controlOut].filter(
        (sample): sample is Vec => sample !== undefined,
      ),
    ),
  );
  if (
    !samples.length ||
    samples.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  )
    return [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of samples) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const semantic: PathSemantic = {
    ...(element.semantic as PathSemantic),
    contours: local.map(
      (contour): PathContour => ({
        points: contour.map((point) =>
          mapPoint(point, (value) => ({
            x: value.x - minX,
            y: value.y - minY,
          })),
        ),
      }),
    ),
  };
  const {
    x: _x,
    y: _y,
    width: _width,
    height: _height,
    ...visual
  } = element.visual;
  const nextCenter = { x: minX + width / 2, y: minY + height / 2 };
  const worldCenter = rotation
    ? rotatePoint(nextCenter, center, rotation)
    : nextCenter;
  return [
    { type: "updateSemantic", id: element.id, semantic },
    {
      type: "replaceVisual",
      id: element.id,
      visual: {
        ...visual,
        x: minX + worldCenter.x - nextCenter.x,
        y: minY + worldCenter.y - nextCenter.y,
        width,
        height,
      },
    },
  ];
}

export class PathAnchorDrag {
  private active: {
    pointer: number;
    element: Element;
    contour: number;
    index: number;
    contours: FreehandPoint[][];
    control?: "controlIn" | "controlOut";
  } | null = null;
  private readonly unsubscribes: (() => void)[];

  constructor(
    private readonly editor: import("./editor.ts").Editor,
    private readonly preview: (
      contours: readonly (readonly FreehandPoint[])[] | null,
    ) => void,
  ) {
    this.unsubscribes = [
      editor.subscribe(() => this.cancel()),
      editor.camera.subscribe(() => this.cancel()),
      editor.selection.subscribe(() => this.cancel()),
    ];
  }

  start(
    pointer: number,
    id: string,
    contour: number,
    index: number,
    control?: "controlIn" | "controlOut",
  ): boolean {
    const element = this.editor.store.get(id);
    if (
      this.active ||
      !element ||
      element.type !== "draw.path" ||
      this.editor.createShapeContext().isLocked?.(id)
    )
      return false;
    const contours = pathWorldContours(element);
    const point = contours[contour]?.[index];
    if (!point || (control && !point[control])) return false;
    this.active = { pointer, element, contour, index, contours, control };
    this.preview(contours);
    return true;
  }

  move(pointer: number, point: Vec): void {
    const active = this.active;
    if (
      !active ||
      active.pointer !== pointer ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    )
      return;
    active.contours = active.contours.map((contour, contourIndex) =>
      contourIndex === active.contour
        ? contour.map((previous, pointIndex) =>
            pointIndex === active.index
              ? active.control
                ? { ...previous, [active.control]: { ...point } }
                : moveStrokeAnchor(previous, point)
              : previous,
          )
        : contour,
    );
    this.preview(active.contours);
  }

  finish(pointer: number, point: Vec): void {
    if (this.active?.pointer !== pointer) return;
    this.move(pointer, point);
    const active = this.active;
    this.cancel();
    if (!active) return;
    const before = pathWorldContours(active.element)[active.contour]?.[
      active.index
    ];
    const after = active.contours[active.contour]?.[active.index];
    const previous = active.control ? before?.[active.control] : before;
    const next = active.control ? after?.[active.control] : after;
    if (previous?.x === next?.x && previous?.y === next?.y) return;
    this.editor.apply(planPathWorldContours(active.element, active.contours));
  }

  cancel(pointer?: number): void {
    if (
      !this.active ||
      (pointer !== undefined && this.active.pointer !== pointer)
    )
      return;
    this.active = null;
    this.preview(null);
  }

  dispose(): void {
    this.cancel();
    for (const unsubscribe of this.unsubscribes) unsubscribe();
  }
}
