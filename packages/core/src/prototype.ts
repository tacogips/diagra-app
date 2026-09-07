import {
  type CornerRadii,
  type Element,
  type ElementId,
  type FillGradient,
  type FontFeatureSetting,
  type FontVariationAxis,
  type FrameSemantic,
  type GenericEdgeSemantic,
  getElementTypeDefinition,
  type PrototypeTrigger,
  type VisualStyle,
} from "@diagra/ir";
import { resolvedCornerRadii } from "./corner-radii.ts";
import type { Editor } from "./editor.ts";
import { backdropEffectsCss, effectsCss } from "./effects.ts";
import { expandContainers } from "./frame-tree.ts";
import { overlapsVisibleElement } from "./selection-geometry.ts";
import { endpointReaderFor } from "./shapes/connector.ts";
import { elementOutlinePolygon } from "./shapes/outline.ts";
import { componentVariants } from "./component-variants.ts";
import { collectInterfaceTree } from "./interface-tree.ts";
import { booleanGeometry, booleanMaskCss } from "./boolean-operations.ts";

export interface PrototypeSmartStep {
  readonly target: ElementId;
  readonly translateX: number;
  readonly translateY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** Equivalent source angle chosen nearest to the destination angle. */
  readonly rotateFrom: number;
  readonly rotateTo: number;
  readonly opacityFrom: number;
  readonly opacityTo: number;
  readonly filterFrom: string;
  readonly filterTo: string;
  readonly backdropFilterFrom?: string;
  readonly backdropFilterTo?: string;
  /** Shared simple paints and numeric typography animated on matched layers. */
  readonly paintFrom?: PrototypeSmartPaint;
  readonly paintTo?: PrototypeSmartPaint;
  readonly fadeIn: boolean;
}

export interface PrototypeSmartPaint {
  readonly fill?: string;
  readonly fillGradient?: FillGradient;
  readonly stroke?: string;
  readonly strokeGradient?: FillGradient;
  readonly strokeWidth?: number;
  readonly strokeCap?: VisualStyle["strokeCap"];
  readonly strokeJoin?: VisualStyle["strokeJoin"];
  readonly strokeMiterLimit?: number;
  readonly cornerRadius?: number;
  readonly cornerRadii?: CornerRadii;
  readonly color?: string;
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly fontWeight?: number;
  readonly fontStyle?: "normal" | "italic";
  readonly fontVariations?: readonly FontVariationAxis[];
  readonly fontFeatures?: readonly FontFeatureSetting[];
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly textAlign?: "start" | "middle" | "end";
  readonly textDecoration?:
    | "none"
    | "underline"
    | "line-through"
    | "underline line-through";
}

export interface PrototypeSmartPlan {
  readonly steps: readonly PrototypeSmartStep[];
  /** Visible source layers that have no valid one-to-one destination match. */
  readonly outgoing: readonly ElementId[];
}

interface DelayedPrototypeLink {
  readonly id: ElementId;
  readonly trigger: PrototypeTrigger;
  readonly delay: number;
  readonly disabled?: boolean;
}

function prototypeAccessibleName(editor: Editor, element: Element): string {
  const explicit = element.accessibility?.label?.trim();
  if (explicit) return explicit;
  const text = editor.getText(element.id)?.trim();
  if (text) return text;
  const semantic = element.semantic as Record<string, unknown>;
  if (element.type === "image.raster" && typeof semantic["alt"] === "string")
    return semantic["alt"].trim();
  if (element.type === "frame" && typeof semantic["name"] === "string")
    return semantic["name"].trim();
  return "";
}

function rotationDelta(from: number, to: number): number {
  const delta = ((((from - to) % 360) + 540) % 360) - 180;
  return Object.is(delta, -0) ? 0 : delta;
}

function smartAppearance(source: Element | undefined, target: Element) {
  const opacityTo = target.visual.style?.opacity ?? 1;
  const filterTo = effectsCss(target.visual.style) ?? "none";
  const backdropFilterTo = backdropEffectsCss(target.visual.style) ?? "none";
  const backdropFilterFrom = source
    ? (backdropEffectsCss(source.visual.style) ?? "none")
    : backdropFilterTo;
  const rotateTo = target.visual.rotation ?? 0;
  const paints = source ? sharedSmartPaint(source, target) : undefined;
  return {
    rotateFrom: source
      ? rotateTo + rotationDelta(source.visual.rotation ?? 0, rotateTo)
      : rotateTo,
    rotateTo,
    opacityFrom: source ? (source.visual.style?.opacity ?? 1) : 0,
    opacityTo,
    filterFrom: source ? (effectsCss(source.visual.style) ?? "none") : filterTo,
    filterTo,
    ...(backdropFilterFrom === "none" && backdropFilterTo === "none"
      ? {}
      : { backdropFilterFrom, backdropFilterTo }),
    ...(paints ? { paintFrom: paints.from, paintTo: paints.to } : {}),
  };
}

function sharedSmartPaint(
  source: Element,
  target: Element,
): { from: PrototypeSmartPaint; to: PrototypeSmartPaint } | undefined {
  const fromStyle = source.visual.style;
  const toStyle = target.visual.style;
  if (!fromStyle || !toStyle) return undefined;
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  const copyPair = (key: keyof PrototypeSmartPaint): void => {
    const fromValue = fromStyle[key];
    const toValue = toStyle[key];
    if (
      (typeof fromValue === "string" && typeof toValue === "string") ||
      (typeof fromValue === "number" && typeof toValue === "number")
    ) {
      from[key] = fromValue;
      to[key] = toValue;
    }
  };
  const copyGradientPair = (
    key: "fillGradient" | "strokeGradient",
  ): boolean => {
    const fromGradient = fromStyle[key];
    const toGradient = toStyle[key];
    if (
      !fromGradient ||
      !toGradient ||
      fromGradient.type !== toGradient.type ||
      (fromGradient.type !== "linear" && fromGradient.type !== "radial") ||
      fromGradient.stops.length !== toGradient.stops.length
    )
      return false;
    from[key] = fromGradient;
    to[key] = toGradient;
    return true;
  };
  const copySettingsPair = (key: "fontVariations" | "fontFeatures"): void => {
    const fromSettings = fromStyle[key];
    const toSettings = toStyle[key];
    if (
      fromSettings &&
      toSettings &&
      fromSettings.length === toSettings.length &&
      fromSettings.every(
        (setting, index) => setting.tag === toSettings[index]?.tag,
      )
    ) {
      from[key] = fromSettings;
      to[key] = toSettings;
    }
  };
  if (!copyGradientPair("fillGradient")) {
    if (!fromStyle.fillGradient && !toStyle.fillGradient) copyPair("fill");
  }
  if (!copyGradientPair("strokeGradient")) {
    if (!fromStyle.strokeGradient && !toStyle.strokeGradient)
      copyPair("stroke");
  }
  copyPair("strokeWidth");
  copyPair("strokeCap");
  copyPair("strokeJoin");
  copyPair("strokeMiterLimit");
  if (fromStyle.cornerRadii || toStyle.cornerRadii) {
    const fallback = source.type === "node.generic" ? 8 : 0;
    from.cornerRadii = resolvedCornerRadii(fromStyle, fallback);
    to.cornerRadii = resolvedCornerRadii(toStyle, fallback);
  } else copyPair("cornerRadius");
  copyPair("color");
  copyPair("fontSize");
  copyPair("fontFamily");
  copyPair("fontWeight");
  copyPair("fontStyle");
  copySettingsPair("fontVariations");
  copySettingsPair("fontFeatures");
  copyPair("lineHeight");
  copyPair("letterSpacing");
  copyPair("textAlign");
  copyPair("textDecoration");
  return Object.keys(from).length
    ? { from: from as PrototypeSmartPaint, to: to as PrototypeSmartPaint }
    : undefined;
}

/** Preview reads the document without changing editor state or history. */
export function prototypeScreen(editor: Editor, frameId: ElementId) {
  const frame = editor.store.get(frameId);
  if (!frame || frame.type !== "frame") return null;
  const context = editor.createShapeContext();
  const bounds = context.boundsOf(frameId);
  if (!bounds || context.isHidden?.(frameId)) return null;
  const overflow = (frame.semantic as FrameSemantic).prototypeOverflow;
  const ids = new Set(expandContainers(editor.store, [frameId], context));
  const elements = editor.store
    .getPageElements(frame.page)
    .filter((element) => {
      if (context.isHidden?.(element.id) || context.isMaskSource?.(element.id))
        return false;
      if (getElementTypeDefinition(element.type)?.category !== "edge")
        return ids.has(element.id);
      if (
        element.type === "edge.generic" &&
        (element.semantic as GenericEdgeSemantic).prototype
      )
        return false;
      const endpoints = endpointReaderFor(element.type)(element.semantic);
      return Boolean(
        endpoints &&
          ids.has(endpoints.from) &&
          ids.has(endpoints.to) &&
          !context.isHidden?.(endpoints.from) &&
          !context.isHidden?.(endpoints.to),
      );
    });
  const focusRank = new Map(
    (collectInterfaceTree(editor, frameId)?.included ?? elements).map(
      (element, index) => [element.id, index],
    ),
  );
  const links = editor.store.getSnapshot().elements.flatMap((element) => {
    if (element.type !== "edge.generic" || context.isHidden?.(element.id))
      return [];
    const semantic = element.semantic as GenericEdgeSemantic;
    const action = semantic.prototypeAction ?? "navigate";
    if (
      !semantic.prototype ||
      !ids.has(semantic.from) ||
      context.isHidden?.(semantic.from)
    )
      return [];
    const target = editor.store.get(semantic.to);
    const source = editor.store.get(semantic.from);
    const hitBox = context.boundsOf(semantic.from);
    const changeSource =
      action === "change-to" && source?.type === "frame"
        ? (source.semantic as FrameSemantic).instanceOf
        : undefined;
    const validTarget =
      target?.type === "frame" &&
      (action === "navigate" ||
        action === "open-overlay" ||
        action === "close-overlay" ||
        Boolean(
          changeSource &&
            componentVariants(editor, changeSource).some(
              (variant) => variant.id === target.id,
            ),
        ));
    if (
      !validTarget ||
      !target ||
      context.isHidden?.(target.id) ||
      !hitBox ||
      !source ||
      !(source.visual.prototypeFixed || !overflow || overflow === "none"
        ? overlapsVisibleElement(source, bounds, context)
        : overflow === "vertical"
          ? hitBox.x < bounds.x + bounds.width &&
            hitBox.x + hitBox.width > bounds.x
          : overflow === "horizontal"
            ? hitBox.y < bounds.y + bounds.height &&
              hitBox.y + hitBox.height > bounds.y
            : true)
    )
      return [];
    const hitPolygon = elementOutlinePolygon(source, context)?.map((point) => ({
      x: point.x - hitBox.x,
      y: point.y - hitBox.y,
    }));
    const boolean = booleanGeometry(source, context);
    const defaultLabel =
      action === "change-to"
        ? "Change component state"
        : action === "open-overlay"
          ? "Open overlay"
          : action === "close-overlay"
            ? "Close overlay"
            : prototypeAccessibleName(editor, source) || "Go to screen";
    return [
      {
        id: element.id,
        from: semantic.from,
        to: semantic.to,
        action,
        label:
          semantic.label || source.accessibility?.label?.trim() || defaultLabel,
        trigger: semantic.prototypeTrigger ?? "click",
        delay: semantic.prototypeDelay ?? 1000,
        transition: semantic.prototypeTransition ?? "instant",
        duration: semantic.prototypeDuration ?? 250,
        overlayPosition: semantic.prototypeOverlayPosition ?? "center",
        overlayX: semantic.prototypeOverlayX ?? 0,
        overlayY: semantic.prototypeOverlayY ?? 0,
        overlayBackdrop: semantic.prototypeOverlayBackdrop ?? false,
        overlayDismiss: semantic.prototypeOverlayDismiss ?? false,
        disabled: Boolean(
          source.accessibility?.disabled || source.accessibility?.decorative,
        ),
        role:
          source.accessibility?.role === "link"
            ? ("link" as const)
            : ("button" as const),
        box: hitBox,
        hitPolygon: hitPolygon ?? null,
        ...(boolean ? { hitMask: booleanMaskCss(boolean) } : {}),
        rotation:
          source.type === "group" ||
          getElementTypeDefinition(source.type)?.category === "edge"
            ? 0
            : (source.visual.rotation ?? 0),
        clip: context.clipOf?.(source.id) ?? null,
        clipPolygon: context.clipPolygonOf?.(source.id) ?? null,
      },
    ];
  });
  links.sort(
    (left, right) =>
      (focusRank.get(left.from) ?? Number.MAX_SAFE_INTEGER) -
        (focusRank.get(right.from) ?? Number.MAX_SAFE_INTEGER) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  return { frame, bounds, elements, links };
}

/** Pick one automatic route without depending on document insertion order. */
export function prototypeDelayedLink<T extends DelayedPrototypeLink>(
  links: readonly T[],
): T | undefined {
  return links
    .filter((link) => link.trigger === "after-delay" && !link.disabled)
    .sort(
      (a, b) => a.delay - b.delay || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0];
}

/**
 * Match destination layers by an explicit, unique component key. Coordinates
 * are relative to each screen so artboards may live anywhere on the canvas.
 */
export function prototypeSmartSteps(
  editor: Editor,
  fromFrameId: ElementId,
  toFrameId: ElementId,
): readonly PrototypeSmartStep[] {
  return prototypeSmartPlan(editor, fromFrameId, toFrameId).steps;
}

export function prototypeSmartPlan(
  editor: Editor,
  fromFrameId: ElementId,
  toFrameId: ElementId,
): PrototypeSmartPlan {
  const from = prototypeScreen(editor, fromFrameId);
  const to = prototypeScreen(editor, toFrameId);
  if (!from || !to) return { steps: [], outgoing: [] };
  return smartPlan(editor, editor, from, to);
}

/** Compare the same preview screen across two transient editor states. */
export function prototypeSmartPlanBetween(
  fromEditor: Editor,
  toEditor: Editor,
  frameId: ElementId,
): PrototypeSmartPlan {
  const from = prototypeScreen(fromEditor, frameId);
  const to = prototypeScreen(toEditor, frameId);
  if (!from || !to) return { steps: [], outgoing: [] };
  return smartPlan(fromEditor, toEditor, from, to);
}

function smartPlan(
  fromEditor: Editor,
  toEditor: Editor,
  from: NonNullable<ReturnType<typeof prototypeScreen>>,
  to: NonNullable<ReturnType<typeof prototypeScreen>>,
): PrototypeSmartPlan {
  const sourceByKey = new Map<string, (typeof from.elements)[number]>();
  const sourceById = new Map(
    from.elements.map((element) => [element.id, element]),
  );
  const sourceDuplicates = new Set<string>();
  for (const element of from.elements) {
    const key = element.visual.componentKey?.trim();
    if (
      !key ||
      element.type === "group" ||
      getElementTypeDefinition(element.type)?.category === "edge"
    )
      continue;
    if (sourceByKey.has(key)) sourceDuplicates.add(key);
    else sourceByKey.set(key, element);
  }
  for (const key of sourceDuplicates) sourceByKey.delete(key);
  const destinationCounts = new Map<string, number>();
  for (const element of to.elements) {
    const key = element.visual.componentKey?.trim();
    if (
      key &&
      element.type !== "group" &&
      getElementTypeDefinition(element.type)?.category !== "edge"
    )
      destinationCounts.set(key, (destinationCounts.get(key) ?? 0) + 1);
  }
  const usedSources = new Set<ElementId>();
  const steps = to.elements.flatMap<PrototypeSmartStep>((target) => {
    if (
      target.type === "group" ||
      getElementTypeDefinition(target.type)?.category === "edge"
    )
      return [];
    const targetBox = toEditor.getBounds(target.id);
    if (!targetBox) return [];
    const key = target.visual.componentKey?.trim();
    const sameId = sourceById.get(target.id);
    const source =
      sameId?.type === target.type
        ? sameId
        : key && destinationCounts.get(key) === 1
          ? sourceByKey.get(key)
          : undefined;
    const sourceBox =
      source?.type === target.type ? fromEditor.getBounds(source.id) : null;
    if (!source || !sourceBox || targetBox.width <= 0 || targetBox.height <= 0)
      return [
        {
          target: target.id,
          translateX: 0,
          translateY: 0,
          scaleX: 1,
          scaleY: 1,
          ...smartAppearance(undefined, target),
          fadeIn: true,
        },
      ];
    usedSources.add(source.id);
    return [
      {
        target: target.id,
        translateX:
          sourceBox.x +
          sourceBox.width / 2 -
          from.bounds.x -
          (targetBox.x + targetBox.width / 2 - to.bounds.x),
        translateY:
          sourceBox.y +
          sourceBox.height / 2 -
          from.bounds.y -
          (targetBox.y + targetBox.height / 2 - to.bounds.y),
        scaleX: sourceBox.width / targetBox.width,
        scaleY: sourceBox.height / targetBox.height,
        ...smartAppearance(source, target),
        fadeIn: false,
      },
    ];
  });
  return {
    steps,
    outgoing: from.elements
      .filter(
        (element) =>
          element.id !== from.frame.id &&
          element.type !== "group" &&
          !usedSources.has(element.id),
      )
      .map((element) => element.id),
  };
}
