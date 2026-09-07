import type { FrameSemantic } from "@diagra/ir";
import type { Command } from "./commands.ts";
import { expandContainers, frameParents } from "./frame-tree.ts";
import { createShapeContext } from "./hit-test.ts";
import type { ShapeUtilRegistry } from "./shape-util.ts";
import type { Store } from "./store.ts";
import { textOwnsAxis } from "./text-layout.ts";
import { maximumSize, minimumSize } from "./size-limits.ts";

/** Allocate remaining main-axis space after fixed/hug siblings have been measured. */
export function planLayoutFill(
  store: Store,
  registry: ShapeUtilRegistry,
  id: string,
): Command[] {
  const frame = store.get(id);
  if (frame?.type !== "frame") return [];
  const { layout, memberIds } = frame.semantic as FrameSemantic;
  if (!layout || !memberIds) return [];
  if (
    !memberIds.some((child) => (store.get(child)?.visual.layoutGrow ?? 0) > 0)
  )
    return [];
  const horizontal = layout.direction === "horizontal";
  const axis = horizontal ? "width" : "height";
  if (
    ((horizontal ? layout.widthSizing : layout.heightSizing) ??
      layout.sizing) !== "fixed"
  )
    return [];
  const context = createShapeContext(store, registry, 1);
  const bounds = context.boundsOf(id);
  if (!bounds || context.isLocked?.(id)) return [];
  const parents = frameParents(store, frame.page, context);
  const children = memberIds.flatMap((childId) => {
    const child = store.get(childId);
    const box = context.boundsOf(childId);
    if (
      !child ||
      !box ||
      parents.get(childId) !== id ||
      child.visual.layoutPosition === "absolute" ||
      context.isHidden?.(childId)
    )
      return [];
    const childLayout =
      child.type === "frame"
        ? (child.semantic as FrameSemantic).layout
        : undefined;
    const childSizing =
      (horizontal ? childLayout?.widthSizing : childLayout?.heightSizing) ??
      childLayout?.sizing;
    const relativeRotation =
      ((((child.visual.rotation ?? 0) - (frame.visual.rotation ?? 0)) % 360) +
        360) %
      360;
    const eligible =
      !context.isLocked?.(childId) &&
      relativeRotation === 0 &&
      !textOwnsAxis(child, axis) &&
      registry.getOrFallback(child.type).canResize &&
      childSizing !== "hug" &&
      !expandContainers(store, [childId], context).includes(id);
    return [
      {
        child,
        size: box[axis],
        weight: eligible ? (child.visual.layoutGrow ?? 0) : 0,
        minimum: minimumSize(child.visual, axis),
        maximum: maximumSize(child.visual, axis),
      },
    ];
  });
  if (!children.some((child) => child.weight > 0)) return [];
  const padding = horizontal
    ? (layout.paddingLeft ?? layout.padding) +
      (layout.paddingRight ?? layout.padding)
    : (layout.paddingTop ?? layout.padding) +
      (layout.paddingBottom ?? layout.padding);
  const capacity = Math.max(0, bounds[axis] - padding);
  type Child = (typeof children)[number];
  const lines: Child[][] = [];
  let occupied = 0;
  for (const child of children) {
    // Flexible children have a portable one-unit basis. This makes line
    // membership independent of geometry produced by an earlier layout pass.
    const basis = child.weight > 0 ? child.minimum : child.size;
    const current = lines.at(-1);
    const addition = (current?.length ? layout.gap : 0) + basis;
    if (
      !current ||
      (layout.wrap && current.length > 0 && occupied + addition > capacity)
    ) {
      lines.push([child]);
      occupied = basis;
    } else {
      current.push(child);
      occupied += addition;
    }
  }
  const sizes = new Map<string, number>();
  for (const line of lines) {
    let pending = line.filter((child) => child.weight > 0);
    let remaining =
      capacity -
      Math.max(0, line.length - 1) * layout.gap -
      line.reduce((sum, child) => sum + (child.weight > 0 ? 0 : child.size), 0);
    const minimumTotal = pending.reduce((sum, child) => sum + child.minimum, 0);
    if (remaining <= minimumTotal) {
      for (const child of pending) sizes.set(child.child.id, child.minimum);
      continue;
    }
    // Normalize before summing to avoid overflow from large finite weights.
    while (pending.length) {
      const maximum = Math.max(...pending.map((child) => child.weight));
      const total = pending.reduce(
        (sum, child) => sum + child.weight / maximum,
        0,
      );
      const share = (child: (typeof pending)[number]) =>
        (remaining * (child.weight / maximum)) / total;
      const small = pending.filter((child) => share(child) < child.minimum);
      if (small.length) {
        for (const child of small) {
          sizes.set(child.child.id, child.minimum);
          remaining -= child.minimum;
        }
        pending = pending.filter((child) => !sizes.has(child.child.id));
        continue;
      }
      const large = pending.filter((child) => share(child) > child.maximum);
      if (large.length) {
        for (const child of large) {
          sizes.set(child.child.id, child.maximum);
          remaining -= child.maximum;
        }
        pending = pending.filter((child) => !sizes.has(child.child.id));
        continue;
      }
      for (const child of pending) sizes.set(child.child.id, share(child));
      break;
    }
  }
  return children.flatMap(({ child, weight }) => {
    if (weight <= 0) return [];
    const size = sizes.get(child.id) ?? 1;
    return child.visual[axis] === size
      ? []
      : [
          {
            type: "updateVisual" as const,
            id: child.id,
            visual: { [axis]: size },
          },
        ];
  });
}
