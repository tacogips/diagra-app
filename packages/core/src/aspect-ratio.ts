import type { Element, FrameSemantic, Visual } from "@diagra/ir";
import { applyCommands, type Command } from "./commands.ts";
import { frameParents } from "./frame-tree.ts";
import { createShapeContext } from "./hit-test.ts";
import type { ShapeUtilRegistry } from "./shape-util.ts";
import type { Store } from "./store.ts";
import { textOwnsAxis } from "./text-layout.ts";

export type AspectDriver = "width" | "height";

export function supportsAspectRatio(element: Element): boolean {
  return (
    ![
      "group",
      "edge.generic",
      "erd.relation",
      "erd.table",
      "uml.association",
      "uml.class",
      "sequence.message",
      "sequence.activation",
    ].includes(element.type) &&
    !textOwnsAxis(element, "width") &&
    !textOwnsAxis(element, "height")
  );
}

export function aspectSize(
  ratio: number,
  width: number,
  height: number,
  driver: AspectDriver,
): { readonly width: number; readonly height: number } {
  return driver === "width"
    ? { width, height: width / ratio }
    : { width: height * ratio, height };
}

/** Apply authored layout bounds without breaking the stored proportion. */
export function boundedAspectSize(
  visual: Visual,
  width: number,
  height: number,
  driver: AspectDriver,
): { readonly width: number; readonly height: number } {
  const ratio = visual.aspectRatio;
  if (!ratio) return { width, height };
  const desired = driver === "width" ? width : height * ratio;
  const minimum = Math.max(
    visual.minWidth ?? 1,
    (visual.minHeight ?? 1) * ratio,
  );
  const maximum = Math.min(
    visual.maxWidth ?? Number.POSITIVE_INFINITY,
    (visual.maxHeight ?? Number.POSITIVE_INFINITY) * ratio,
  );
  const bounded = Math.min(maximum, Math.max(minimum, desired));
  return { width: bounded, height: bounded / ratio };
}

/** Reconcile stored ratios before/after constraints and auto layout. */
export function planAspectRatios(
  store: Store,
  registry: ShapeUtilRegistry,
): Command[] {
  if (
    !store
      .getSnapshot()
      .elements.some((element) => element.visual.aspectRatio !== undefined)
  )
    return [];
  const context = createShapeContext(store, registry, 1);
  const parents = new Map<string, string>();
  for (const page of store.listPages())
    for (const [child, parent] of frameParents(store, page.id, context))
      parents.set(child, parent);
  const commands: Command[] = [];
  for (const element of store.getSnapshot().elements) {
    const ratio = element.visual.aspectRatio;
    const box = context.boundsOf(element.id);
    const util = registry.getOrFallback(element.type);
    if (
      ratio === undefined ||
      !box ||
      !supportsAspectRatio(element) ||
      !util.canResize ||
      !util.resize ||
      context.isLocked?.(element.id)
    )
      continue;
    const parentId = parents.get(element.id);
    const parent = parentId ? store.get(parentId) : undefined;
    const parentLayout =
      parent?.type === "frame" && element.visual.layoutPosition !== "absolute"
        ? (parent.semantic as FrameSemantic).layout
        : undefined;
    const ownLayout =
      element.type === "frame"
        ? (element.semantic as FrameSemantic).layout
        : undefined;
    const driver: AspectDriver =
      (parentLayout ?? ownLayout)?.direction === "vertical"
        ? "height"
        : "width";
    const size = boundedAspectSize(
      element.visual,
      box.width,
      box.height,
      driver,
    );
    const dependent = driver === "width" ? "height" : "width";
    const links = { ...element.visual.numberTokens };
    delete links[dependent];
    const resized = util.resize(element, { ...box, ...size }).visual;
    const { numberTokens: _oldLinks, ...rest } = element.visual;
    const visual: Visual = {
      ...rest,
      ...resized,
      ...(Object.keys(links).length ? { numberTokens: links } : {}),
    };
    if (JSON.stringify(visual) === JSON.stringify(element.visual)) continue;
    const command: Command = {
      type: "replaceVisual",
      id: element.id,
      visual,
    };
    applyCommands(store, [command]);
    commands.push(command);
  }
  return commands;
}
