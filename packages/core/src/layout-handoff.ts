import type { ElementId, FrameSemantic } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { frameParents } from "./frame-tree.ts";
import { numberTokenCssName } from "./token-handoff.ts";
import { supportsAspectRatio } from "./aspect-ratio.ts";

export interface LayoutHandoffOptions {
  /** Optional export filter; excluded children consume no DOM/flex position. */
  readonly include?: (id: ElementId) => boolean;
}

/** Flow-layout rules with explicit overlay children retained in DOM order. */
function singleLayoutHandoff(
  editor: Editor,
  id: ElementId,
  options: LayoutHandoffOptions,
) {
  const frame = editor.store.get(id);
  if (frame?.type !== "frame") return null;
  const semantic = frame.semantic as FrameSemantic;
  const layout = semantic.layout;
  const bounds = editor.getBounds(id);
  if (!layout || !bounds || !semantic.memberIds) return null;
  const context = editor.createShapeContext();
  const parents = frameParents(editor.store, frame.page, context);
  const children = semantic.memberIds.flatMap((childId) => {
    const element = editor.store.get(childId);
    const box = context.boundsOf(childId);
    return element &&
      box &&
      parents.get(childId) === id &&
      !context.isHidden?.(childId) &&
      (options.include?.(childId) ?? true)
      ? [{ element, box }]
      : [];
  });
  const horizontal = layout.direction === "horizontal";
  const px = (value: number) => `${Number(value.toFixed(4))}px`;
  const linkedPx = (
    field:
      | "gap"
      | "crossGap"
      | "padding"
      | "paddingTop"
      | "paddingRight"
      | "paddingBottom"
      | "paddingLeft",
    value: number,
  ) => {
    const tokenId = frame.visual.numberTokens?.[field];
    const token = tokenId ? editor.store.get(tokenId) : undefined;
    return token?.type === "design.token" &&
      (token.semantic as { kind?: unknown }).kind === "number"
      ? `var(${numberTokenCssName(tokenId as string)}, ${px(value)})`
      : px(value);
  };
  const linkedVisualPx = (
    element: (typeof children)[number]["element"],
    field: "minWidth" | "maxWidth" | "minHeight" | "maxHeight",
    value: number,
  ) => {
    const tokenId = element.visual.numberTokens?.[field];
    const token = tokenId ? editor.store.get(tokenId) : undefined;
    return token?.type === "design.token" &&
      (token.semantic as { kind?: unknown }).kind === "number"
      ? `var(${numberTokenCssName(tokenId as string)}, ${px(value)})`
      : px(value);
  };
  const axis = (dimension: "width" | "height") =>
    (layout[dimension === "width" ? "widthSizing" : "heightSizing"] ??
      layout.sizing) === "hug"
      ? "max-content"
      : px(bounds[dimension]);
  const justify = layout.justify ?? "start";
  const className = `diagra-layout-${Array.from(id, (char) => char.codePointAt(0)?.toString(16)).join("-")}`;
  const paddingValues = [
    ["paddingTop", layout.paddingTop ?? layout.padding],
    ["paddingRight", layout.paddingRight ?? layout.padding],
    ["paddingBottom", layout.paddingBottom ?? layout.padding],
    ["paddingLeft", layout.paddingLeft ?? layout.padding],
  ] as const;
  const gapCss = (linked: boolean) => {
    const value = (field: "gap" | "crossGap", fallback: number) =>
      linked ? linkedPx(field, fallback) : px(fallback);
    if (!layout.wrap) return `gap: ${value("gap", layout.gap)};`;
    const crossField = layout.crossGap === undefined ? "gap" : "crossGap";
    return `column-gap: ${value(horizontal ? "gap" : crossField, horizontal ? layout.gap : (layout.crossGap ?? layout.gap))};\n  row-gap: ${value(horizontal ? crossField : "gap", horizontal ? (layout.crossGap ?? layout.gap) : layout.gap)};`;
  };
  const rootCss = (linked: boolean) =>
    `.diagra-layout {\n  display: flex;\n  box-sizing: border-box;\n  flex-direction: ${horizontal ? "row" : "column"};\n  flex-wrap: ${layout.wrap ? "wrap" : "nowrap"};\n  width: ${axis("width")};\n  height: ${axis("height")};${frame.visual.minWidth === undefined ? "" : `\n  min-width: ${linked ? linkedVisualPx(frame, "minWidth", frame.visual.minWidth) : px(frame.visual.minWidth)};`}${frame.visual.maxWidth === undefined ? "" : `\n  max-width: ${linked ? linkedVisualPx(frame, "maxWidth", frame.visual.maxWidth) : px(frame.visual.maxWidth)};`}${frame.visual.minHeight === undefined ? "" : `\n  min-height: ${linked ? linkedVisualPx(frame, "minHeight", frame.visual.minHeight) : px(frame.visual.minHeight)};`}${frame.visual.maxHeight === undefined ? "" : `\n  max-height: ${linked ? linkedVisualPx(frame, "maxHeight", frame.visual.maxHeight) : px(frame.visual.maxHeight)};`}\n  ${gapCss(linked)}\n  padding: ${[layout.paddingTop, layout.paddingRight, layout.paddingBottom, layout.paddingLeft].map((value) => px(value ?? layout.padding)).join(" ")};\n  align-items: ${layout.align === "start" ? "flex-start" : layout.align === "end" ? "flex-end" : layout.align};\n  align-content: flex-start;\n  justify-content: ${justify === "start" ? "flex-start" : justify === "end" ? "safe flex-end" : justify === "center" ? "safe center" : justify};\n  overflow: ${semantic.clipContent ? "hidden" : "visible"};\n}`.replace(
      `padding: ${paddingValues.map(([, value]) => px(value)).join(" ")};`,
      `padding: ${paddingValues.map(([field, value]) => (linked ? linkedPx(frame.visual.numberTokens?.[field] ? field : "padding", value) : px(value))).join(" ")};`,
    );
  const css = [rootCss(false)];
  const linkedCss = [rootCss(true)];
  if (frame.visual.aspectRatio !== undefined) {
    const ratioRule = `.diagra-layout {\n  aspect-ratio: ${frame.visual.aspectRatio};\n}`;
    css.push(ratioRule);
    linkedCss.push(ratioRule);
  }
  const childRules: {
    grow: number;
    width: string;
    height: string;
    absolute: boolean;
    minWidth: string;
    linkedMinWidth: string;
    maxWidth?: string;
    linkedMaxWidth?: string;
    minHeight: string;
    linkedMinHeight: string;
    maxHeight?: string;
    linkedMaxHeight?: string;
    aspectRatio?: number;
    left?: string;
    top?: string;
  }[] = [];
  for (const { element, box } of children) {
    const childLayout =
      element.type === "frame"
        ? (element.semantic as FrameSemantic).layout
        : undefined;
    const main = horizontal ? "widthSizing" : "heightSizing";
    const cross = horizontal ? "heightSizing" : "widthSizing";
    const absolute = element.visual.layoutPosition === "absolute";
    const eligible =
      !absolute &&
      !element.visual.rotation &&
      !context.isLocked?.(element.id) &&
      editor.getShapeUtil(element.type).canResize;
    const grow =
      eligible &&
      (layout[main] ?? layout.sizing) === "fixed" &&
      (childLayout?.[main] ?? childLayout?.sizing) !== "hug"
        ? (element.visual.layoutGrow ?? 0)
        : 0;
    const stretch =
      eligible &&
      layout.align === "stretch" &&
      !(
        element.visual.aspectRatio !== undefined && supportsAspectRatio(element)
      ) &&
      (layout[cross] ?? layout.sizing) === "fixed" &&
      (childLayout?.[cross] ?? childLayout?.sizing) !== "hug";
    const size = (dimension: "width" | "height") =>
      stretch && dimension === (horizontal ? "height" : "width")
        ? "auto"
        : (childLayout?.[
              dimension === "width" ? "widthSizing" : "heightSizing"
            ] ?? childLayout?.sizing) === "hug"
          ? "max-content"
          : px(box[dimension]);
    childRules.push({
      grow,
      width: size("width"),
      height: size("height"),
      absolute,
      minWidth: px(element.visual.minWidth ?? 1),
      linkedMinWidth:
        element.visual.minWidth === undefined
          ? px(1)
          : linkedVisualPx(element, "minWidth", element.visual.minWidth),
      ...(element.visual.maxWidth === undefined
        ? {}
        : {
            maxWidth: px(element.visual.maxWidth),
            linkedMaxWidth: linkedVisualPx(
              element,
              "maxWidth",
              element.visual.maxWidth,
            ),
          }),
      minHeight: px(element.visual.minHeight ?? 1),
      linkedMinHeight:
        element.visual.minHeight === undefined
          ? px(1)
          : linkedVisualPx(element, "minHeight", element.visual.minHeight),
      ...(element.visual.maxHeight === undefined
        ? {}
        : {
            maxHeight: px(element.visual.maxHeight),
            linkedMaxHeight: linkedVisualPx(
              element,
              "maxHeight",
              element.visual.maxHeight,
            ),
          }),
      ...(element.visual.aspectRatio === undefined
        ? {}
        : { aspectRatio: element.visual.aspectRatio }),
      ...(absolute
        ? { left: px(box.x - bounds.x), top: px(box.y - bounds.y) }
        : {}),
    });
  }
  // Unlike the design allocator, CSS distributes only a fraction of free
  // space when grow factors total less than one. Preserve ratios while
  // ensuring at least one factor is one and avoiding large-number sums.
  const maximum = childRules.reduce((max, rule) => Math.max(max, rule.grow), 0);
  const childRule = (
    rule: (typeof childRules)[number],
    index: number,
    linked: boolean,
  ) => {
    const minWidth = linked ? rule.linkedMinWidth : rule.minWidth;
    const maxWidth = linked ? rule.linkedMaxWidth : rule.maxWidth;
    const minHeight = linked ? rule.linkedMinHeight : rule.minHeight;
    const maxHeight = linked ? rule.linkedMaxHeight : rule.maxHeight;
    const grow = maximum > 0 ? rule.grow / maximum : 0;
    const aspect =
      rule.aspectRatio === undefined
        ? ""
        : `\n  aspect-ratio: ${rule.aspectRatio};`;
    return `.diagra-layout > :nth-child(${index + 1}) {\n  position: ${rule.absolute ? "absolute" : "relative"};${rule.absolute ? `\n  left: ${rule.left};\n  top: ${rule.top};` : ""}\n  box-sizing: border-box;\n  flex: ${rule.grow > 0 ? `${grow} 0 0px` : "0 0 auto"};${aspect}\n  min-width: ${minWidth};${maxWidth ? `\n  max-width: ${maxWidth};` : ""}\n  min-height: ${minHeight};${maxHeight ? `\n  max-height: ${maxHeight};` : ""}\n  width: ${rule.width};\n  height: ${rule.height};\n}`;
  };
  for (const [index, rule] of childRules.entries()) {
    css.push(childRule(rule, index, false));
    linkedCss.push(childRule(rule, index, true));
  }
  return {
    css: css.join("\n\n").replaceAll(".diagra-layout", `.${className}`),
    linkedCss: linkedCss
      .join("\n\n")
      .replaceAll(".diagra-layout", `.${className}`),
    className,
    childOrder: children.map(({ element }) => element.id),
    notes: [
      "Use the listed visible direct children in DOM order. Flow children use flex sizing and authored min/max limits; absolute children retain their parent-relative overlay offsets.",
      "Apply each frame's class to its container. Text measurement, border sizing and semantic shapes require implementation and browser verification.",
    ],
  };
}

/** Include reachable explicit nested layouts once, with isolated CSS classes. */
export function layoutHandoff(
  editor: Editor,
  id: ElementId,
  options: LayoutHandoffOptions = {},
) {
  const root = singleLayoutHandoff(editor, id, options);
  if (!root) return null;
  const frames = [{ id, ...root }];
  const seen = new Set([id]);
  const queue = [...root.childOrder];
  for (let at = 0; at < queue.length; at++) {
    const child = queue[at];
    if (!child || seen.has(child)) continue;
    seen.add(child);
    const layout = singleLayoutHandoff(editor, child, options);
    if (!layout) continue;
    frames.push({ id: child, ...layout });
    queue.push(...layout.childOrder);
  }
  return {
    ...root,
    css: frames.map((frame) => frame.css).join("\n\n"),
    linkedCss: frames.map((frame) => frame.linkedCss).join("\n\n"),
    frames: frames.map(({ id, className, childOrder }) => ({
      id,
      className,
      childOrder,
    })),
  };
}
