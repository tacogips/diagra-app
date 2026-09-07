import type { ElementId, FrameSemantic } from "@diagra/ir";
import { applyCommands, type Command } from "./commands.ts";
import { expandContainers, frameParents } from "./frame-tree.ts";
import { createShapeContext } from "./hit-test.ts";
import { type Box, boxCenter, rotatePoint } from "./geometry.ts";
import type { ShapeUtilRegistry } from "./shape-util.ts";
import type { Store } from "./store.ts";
import { planLayoutFill } from "./layout-fill.ts";
import { textOwnsAxis } from "./text-layout.ts";
import { clampLayoutSize } from "./size-limits.ts";
import { boundedAspectSize, supportsAspectRatio } from "./aspect-ratio.ts";

function relativeRotation(
  child: { visual: { rotation?: number } },
  parent: { visual: { rotation?: number } },
): number {
  return (
    ((((child.visual.rotation ?? 0) - (parent.visual.rotation ?? 0)) % 360) +
      360) %
    360
  );
}

function boxInFrameSpace(box: Box, frame: Box, rotation: number): Box {
  if (!rotation) return box;
  const center = rotatePoint(boxCenter(box), boxCenter(frame), -rotation);
  return {
    x: center.x - box.width / 2,
    y: center.y - box.height / 2,
    width: box.width,
    height: box.height,
  };
}

function boxFromFrameSpace(box: Box, frame: Box, rotation: number): Box {
  if (!rotation) return box;
  const center = rotatePoint(boxCenter(box), boxCenter(frame), rotation);
  return {
    x: center.x - box.width / 2,
    y: center.y - box.height / 2,
    width: box.width,
    height: box.height,
  };
}

/** Plan against a private working store; callers commit the result atomically. */
export function planAutoLayout(
  store: Store,
  registry: ShapeUtilRegistry,
): Command[] {
  const result: Command[] = [];
  const visited = new Set<ElementId>();
  const commit = (commands: Command[]): void => {
    if (!commands.length) return;
    applyCommands(store, commands);
    result.push(...commands);
  };
  const visit = (id: ElementId): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const element = store.get(id);
    if (element?.type === "group") {
      for (const child of (element.semantic as { memberIds: string[] })
        .memberIds)
        visit(child);
      return;
    }
    if (!element || element.type !== "frame") return;
    const semantic = element.semantic as FrameSemantic;
    const frameRotation = element.visual.rotation ?? 0;
    const layout = semantic.layout;
    // Size the cross axis before descending so nested layouts see their final width/height.
    if (layout?.align === "stretch" && !layout.wrap && semantic.memberIds) {
      const context = createShapeContext(store, registry, 1);
      const box = context.boundsOf(id);
      const horizontal = layout.direction === "horizontal";
      const sizing = horizontal ? layout.heightSizing : layout.widthSizing;
      if (
        box &&
        !context.isLocked?.(id) &&
        (sizing ?? layout.sizing) === "fixed"
      ) {
        const dimension = horizontal ? "height" : "width";
        const padding = horizontal
          ? (layout.paddingTop ?? layout.padding) +
            (layout.paddingBottom ?? layout.padding)
          : (layout.paddingLeft ?? layout.padding) +
            (layout.paddingRight ?? layout.padding);
        const size = Math.max(1, box[dimension] - padding);
        const parents = frameParents(store, element.page, context);
        const commands: Command[] = [];
        for (const childId of semantic.memberIds) {
          const child = store.get(childId);
          if (
            !child ||
            parents.get(childId) !== id ||
            child.visual.layoutPosition === "absolute" ||
            context.isLocked?.(childId) ||
            context.isHidden?.(childId) ||
            relativeRotation(child, element) !== 0 ||
            (child.visual.aspectRatio !== undefined &&
              supportsAspectRatio(child)) ||
            textOwnsAxis(child, dimension) ||
            !registry.getOrFallback(child.type).canResize
          )
            continue;
          const childLayout =
            child.type === "frame"
              ? (child.semantic as FrameSemantic).layout
              : undefined;
          const childSizing = horizontal
            ? childLayout?.heightSizing
            : childLayout?.widthSizing;
          // A hug-sized child owns its dimension; avoid a parent/child sizing cycle.
          if (childLayout && (childSizing ?? childLayout.sizing) === "hug")
            continue;
          const bounded = clampLayoutSize(child.visual, dimension, size);
          if (child.visual[dimension] !== bounded)
            commands.push({
              type: "updateVisual",
              id: childId,
              visual: { [dimension]: bounded },
            });
        }
        commit(commands);
      }
    }
    for (const child of semantic.memberIds ?? []) visit(child);
    const fill = planLayoutFill(store, registry, id);
    commit(fill);
    for (const command of fill) {
      if (!("id" in command)) continue;
      const context = createShapeContext(store, registry, 1);
      for (const child of expandContainers(store, [command.id], context))
        if (child !== id) visited.delete(child);
      visit(command.id);
    }
    if (!layout || !semantic.memberIds) return;
    const context = createShapeContext(store, registry, 1);
    const box = context.boundsOf(id);
    if (!box || context.isLocked?.(id)) return;
    const parents = frameParents(store, element.page, context);
    const children = semantic.memberIds.flatMap((child) => {
      const pageBox = context.boundsOf(child);
      return pageBox &&
        parents.get(child) === id &&
        !context.isHidden?.(child) &&
        store.get(child)?.visual.layoutPosition !== "absolute"
        ? [
            {
              id: child,
              pageBox,
              box: boxInFrameSpace(pageBox, box, frameRotation),
            },
          ]
        : [];
    });
    const horizontal = layout.direction === "horizontal";
    const top = layout.paddingTop ?? layout.padding;
    const right = layout.paddingRight ?? layout.padding;
    const bottom = layout.paddingBottom ?? layout.padding;
    const left = layout.paddingLeft ?? layout.padding;
    const mainStart = horizontal ? left : top;
    const mainPadding = horizontal ? left + right : top + bottom;
    const crossStart = horizontal ? top : left;
    const crossPadding = horizontal ? top + bottom : left + right;
    const parentMainSize = horizontal ? box.width : box.height;
    const mainSizing = horizontal
      ? (layout.widthSizing ?? layout.sizing)
      : (layout.heightSizing ?? layout.sizing);
    const wrap = layout.wrap === true && mainSizing === "fixed";
    const availableMain = Math.max(0, parentMainSize - mainPadding);
    type LayoutChild = (typeof children)[number];
    interface LayoutLine {
      readonly children: LayoutChild[];
      mainSize: number;
      crossSize: number;
    }
    const lines: LayoutLine[] = [];
    for (const child of children) {
      const childMain = horizontal ? child.box.width : child.box.height;
      const childCross = horizontal ? child.box.height : child.box.width;
      let line = lines.at(-1);
      if (
        !line ||
        (wrap &&
          line.children.length > 0 &&
          line.mainSize + layout.gap + childMain > availableMain)
      ) {
        line = { children: [], mainSize: 0, crossSize: 0 };
        lines.push(line);
      }
      if (line.children.length) line.mainSize += layout.gap;
      line.children.push(child);
      line.mainSize += childMain;
      line.crossSize = Math.max(line.crossSize, childCross);
    }
    const crossGap = layout.crossGap ?? layout.gap;
    const contentMain = Math.max(0, ...lines.map((line) => line.mainSize));
    const contentCross =
      lines.reduce((sum, line) => sum + line.crossSize, 0) +
      Math.max(0, lines.length - 1) * crossGap;
    if (wrap && layout.align === "stretch") {
      const dimension = horizontal ? "height" : "width";
      const stretchCommands: Command[] = [];
      const stretchedFrames: ElementId[] = [];
      for (const line of lines) {
        for (const child of line.children) {
          const childElement = store.get(child.id);
          const childLayout =
            childElement?.type === "frame"
              ? (childElement.semantic as FrameSemantic).layout
              : undefined;
          const childSizing = horizontal
            ? childLayout?.heightSizing
            : childLayout?.widthSizing;
          if (
            !childElement ||
            context.isLocked?.(child.id) ||
            relativeRotation(childElement, element) !== 0 ||
            (childElement.visual.aspectRatio !== undefined &&
              supportsAspectRatio(childElement)) ||
            textOwnsAxis(childElement, dimension) ||
            !registry.getOrFallback(childElement.type).canResize ||
            (childLayout && (childSizing ?? childLayout.sizing) === "hug") ||
            child.box[dimension] ===
              clampLayoutSize(childElement.visual, dimension, line.crossSize)
          )
            continue;
          const bounded = clampLayoutSize(
            childElement.visual,
            dimension,
            line.crossSize,
          );
          stretchCommands.push({
            type: "updateVisual",
            id: child.id,
            visual: { [dimension]: bounded },
          });
          child.box = { ...child.box, [dimension]: bounded };
          child.pageBox = { ...child.pageBox, [dimension]: bounded };
          if (childElement.type === "frame") stretchedFrames.push(child.id);
        }
      }
      commit(stretchCommands);
      for (const childId of stretchedFrames) {
        visited.delete(childId);
        visit(childId);
      }
    }
    let width =
      (layout.widthSizing ?? layout.sizing) === "hug"
        ? clampLayoutSize(
            element.visual,
            "width",
            (horizontal ? contentMain : contentCross) + left + right,
          )
        : box.width;
    let height =
      (layout.heightSizing ?? layout.sizing) === "hug"
        ? clampLayoutSize(
            element.visual,
            "height",
            (horizontal ? contentCross : contentMain) + top + bottom,
          )
        : box.height;
    if (element.visual.aspectRatio !== undefined) {
      const size = boundedAspectSize(
        element.visual,
        width,
        height,
        horizontal ? "width" : "height",
      );
      width = size.width;
      height = size.height;
    }
    const commands: Command[] = [];
    if (width !== box.width || height !== box.height)
      commands.push({ type: "updateVisual", id, visual: { width, height } });
    const layoutBox: Box = { ...box, width, height };
    const moved = new Set<ElementId>();
    let lineCursor = crossStart;
    for (const line of lines) {
      const lineCrossSize = wrap
        ? line.crossSize
        : Math.max(0, (horizontal ? height : width) - crossPadding);
      // Preserve the configured minimum gap; overflowing lines remain
      // start-aligned and distribution is calculated independently per line.
      const free = Math.max(
        0,
        (horizontal ? width : height) - mainPadding - line.mainSize,
      );
      const gap =
        layout.gap +
        (layout.justify === "space-between" && line.children.length > 1
          ? free / (line.children.length - 1)
          : 0);
      let cursor =
        mainStart +
        (layout.justify === "center"
          ? free / 2
          : layout.justify === "end"
            ? free
            : 0);
      for (const child of line.children) {
        const childCross = horizontal ? child.box.height : child.box.width;
        const extra = lineCrossSize - childCross;
        const cross =
          lineCursor +
          (layout.align === "center"
            ? extra / 2
            : layout.align === "end"
              ? extra
              : 0);
        const localTarget: Box = {
          x: layoutBox.x + (horizontal ? cursor : cross),
          y: layoutBox.y + (horizontal ? cross : cursor),
          width: child.box.width,
          height: child.box.height,
        };
        const pageTarget = boxFromFrameSpace(
          localTarget,
          layoutBox,
          frameRotation,
        );
        const dx = pageTarget.x - child.pageBox.x;
        const dy = pageTarget.y - child.pageBox.y;
        for (const member of expandContainers(store, [child.id], context)) {
          if (moved.has(member) || context.isLocked?.(member)) continue;
          moved.add(member);
          const visual = store.get(member)?.visual;
          if (
            !visual ||
            visual.x === undefined ||
            visual.y === undefined ||
            (dx === 0 && dy === 0)
          )
            continue;
          commands.push({
            type: "updateVisual",
            id: member,
            visual: { x: visual.x + dx, y: visual.y + dy },
          });
        }
        cursor += (horizontal ? child.box.width : child.box.height) + gap;
      }
      lineCursor += lineCrossSize + crossGap;
    }
    commit(commands);
  };
  const elements = store.getSnapshot().elements;
  const members = new Set(
    elements.flatMap((element) =>
      element.type === "frame" || element.type === "group"
        ? ((element.semantic as { memberIds?: string[] }).memberIds ?? [])
        : [],
    ),
  );
  for (const element of elements)
    if (!members.has(element.id)) visit(element.id);
  for (const element of elements) visit(element.id);
  return result;
}
