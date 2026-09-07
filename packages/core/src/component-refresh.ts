import type {
  Element,
  ElementId,
  FrameSemantic,
  TextMark,
  TextNoteSemantic,
  VisualStyle,
} from "@diagra/ir";
import type { Editor } from "./editor.ts";
import type { Command } from "./commands.ts";
import { expandContainers } from "./frame-tree.ts";
import {
  normalizeTextMarks,
  rebaseTextMarks,
  textNoteMarks,
} from "./rich-text.ts";

const TYPOGRAPHY_STYLE_FIELDS = new Set([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textDecoration",
  "verticalAlign",
]);

export const COMPONENT_GEOMETRY_FIELDS = [
  "x",
  "y",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "aspectRatio",
  "rotation",
] as const;

export type ComponentGeometryField = (typeof COMPONENT_GEOMETRY_FIELDS)[number];

function geometrySnapshot(element: Element): Record<string, number> {
  return Object.fromEntries(
    COMPONENT_GEOMETRY_FIELDS.flatMap((field) => {
      const value = element.visual[field];
      return value === undefined ? [] : [[field, value]];
    }),
  );
}

function snapshot(editor: Editor, element: Element): string {
  return JSON.stringify({
    text: editor.getText(element.id),
    marks: element.type === "text.note" ? textNoteMarks(element.semantic) : [],
    style: element.visual.style ?? {},
    colorTokens: element.visual.colorTokens ?? {},
    numberTokens: element.visual.numberTokens ?? {},
    textStyle: element.visual.textStyle,
    geometry: geometrySnapshot(element),
  });
}

/** Translate source-space geometry into an instance's page-space geometry. */
export function componentGeometryValue(
  field: ComponentGeometryField,
  geometry: Record<string, unknown>,
  sourceRootGeometry: Record<string, unknown>,
  instance: Element,
  root: boolean,
): unknown {
  const value = geometry[field];
  if ((field !== "x" && field !== "y") || root) return value;
  if (typeof value !== "number") return value;
  const sourceRoot = sourceRootGeometry[field];
  const instanceRoot = instance.visual[field];
  return (
    value -
    (typeof sourceRoot === "number" ? sourceRoot : 0) +
    (typeof instanceRoot === "number" ? instanceRoot : 0)
  );
}

export function componentBindings(
  editor: Editor,
  mapping: ReadonlyMap<ElementId, ElementId>,
): NonNullable<FrameSemantic["instanceBindings"]> {
  return [...mapping].flatMap(([source, target]) => {
    const element = editor.store.get(source);
    return element
      ? [{ source, target, baseline: snapshot(editor, element) }]
      : [];
  });
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function componentValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const left = object(a);
  const right = object(b);
  if (!left || !right) return JSON.stringify(a) === JSON.stringify(b);
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        componentValuesEqual(left[key], right[key]),
    )
  );
}

const equal = componentValuesEqual;

/** Linked values change independently of component snapshots; compare identity. */
export function inheritedStyleField(
  target: Element,
  baseline: Record<string, unknown>,
  key: string,
): boolean {
  if (key === "cornerRadii") {
    const previous = object(baseline["style"])?.[key];
    const current = target.visual.style?.cornerRadii;
    const previousRadii = object(previous);
    const currentRadii = object(current);
    if (!previousRadii || !currentRadii) return equal(previous, current);
    for (const [link, corner] of [
      ["cornerTopLeft", "topLeft"],
      ["cornerTopRight", "topRight"],
      ["cornerBottomRight", "bottomRight"],
      ["cornerBottomLeft", "bottomLeft"],
    ] as const) {
      const previousLink = object(baseline["numberTokens"])?.[link];
      const currentLink = (
        target.visual.numberTokens as Record<string, unknown> | undefined
      )?.[link];
      if (previousLink !== undefined || currentLink !== undefined) {
        if (!equal(previousLink, currentLink)) return false;
      } else if (!equal(previousRadii[corner], currentRadii[corner]))
        return false;
    }
    return true;
  }
  if (TYPOGRAPHY_STYLE_FIELDS.has(key)) {
    const previousTextStyle = baseline["textStyle"];
    const currentTextStyle = target.visual.textStyle;
    if (previousTextStyle !== undefined || currentTextStyle !== undefined)
      return equal(previousTextStyle, currentTextStyle);
  }
  const previousLink = object(baseline["colorTokens"])?.[key];
  const currentLink = (
    target.visual.colorTokens as Record<string, unknown> | undefined
  )?.[key];
  if (previousLink !== undefined || currentLink !== undefined)
    return equal(previousLink, currentLink);
  const previousNumberLink = object(baseline["numberTokens"])?.[key];
  const currentNumberLink = (
    target.visual.numberTokens as Record<string, unknown> | undefined
  )?.[key];
  if (previousNumberLink !== undefined || currentNumberLink !== undefined)
    return equal(previousNumberLink, currentNumberLink);
  return equal(
    (target.visual.style as Record<string, unknown> | undefined)?.[key],
    object(baseline["style"])?.[key],
  );
}

/** Measurement values materialize independently; component inheritance follows the link. */
export function inheritedNumberField(
  target: Element,
  baseline: Record<string, unknown>,
  key: string,
): boolean {
  return equal(
    (target.visual.numberTokens as Record<string, unknown> | undefined)?.[key],
    object(baseline["numberTokens"])?.[key],
  );
}

/** Refresh inherited text/style fields, preserving overrides and element IDs. */
export function planComponentRefresh(
  editor: Editor,
  id: ElementId,
): Command[] | null {
  const instance = editor.store.get(id);
  if (!instance || instance.type !== "frame") return null;
  const semantic = instance.semantic as FrameSemantic;
  const sourceId = semantic.instanceOf ?? semantic.responsiveSource;
  const source = sourceId ? editor.store.get(sourceId) : undefined;
  if (
    !source ||
    source.type !== "frame" ||
    (semantic.instanceOf !== undefined &&
      !(source.semantic as FrameSemantic).component) ||
    !semantic.instanceBindings?.length
  )
    return null;
  const context = editor.createShapeContext();
  const targets = new Set(expandContainers(editor.store, [id], context));
  const sources = new Set(expandContainers(editor.store, [source.id], context));
  if (
    targets.has(source.id) ||
    sources.has(id) ||
    [...targets].some((target) => context.isLocked?.(target))
  )
    return null;
  const commands: Command[] = [];
  const bindings: NonNullable<FrameSemantic["instanceBindings"]>[number][] = [];
  let rootBaseline: Record<string, unknown> | null = null;
  if (semantic.instanceOf) {
    const rootBinding = semantic.instanceBindings.find(
      (binding) => binding.source === source.id && binding.target === id,
    );
    try {
      rootBaseline = rootBinding
        ? object(JSON.parse(rootBinding.baseline))
        : null;
    } catch {
      return null;
    }
  }
  const oldRootGeometry = object(rootBaseline?.["geometry"]);
  const sourceRootGeometry = geometrySnapshot(source);
  const seen = new Set<string>();
  let rootSemantic: unknown = semantic;
  for (const binding of semantic.instanceBindings) {
    if (
      !binding.source ||
      !binding.target ||
      !sources.has(binding.source) ||
      !targets.has(binding.target)
    ) {
      bindings.push(binding);
      continue;
    }
    const original = editor.store.get(binding.source);
    const target = editor.store.get(binding.target);
    if (
      !original ||
      !target ||
      original.type !== target.type ||
      seen.has(target.id)
    )
      return null;
    seen.add(target.id);
    let baseline: Record<string, unknown> | null;
    try {
      baseline = object(JSON.parse(binding.baseline));
    } catch {
      return null;
    }
    if (!baseline || !object(baseline["style"])) return null;
    const oldStyle = object(baseline["style"]) ?? {};
    const currentStyle = target.visual.style ?? {};
    const sourceStyle = original.visual.style ?? {};
    const nextStyle: Record<string, unknown> = { ...currentStyle };
    const nextLinks: Record<string, string> = { ...target.visual.colorTokens };
    const nextNumberLinks: Record<string, string> = {
      ...target.visual.numberTokens,
    };
    const nextTextStyle = equal(baseline["textStyle"], target.visual.textStyle)
      ? original.visual.textStyle
      : target.visual.textStyle;
    for (const key of new Set([
      ...Object.keys(oldStyle),
      ...Object.keys(sourceStyle),
      ...Object.keys(object(baseline["colorTokens"]) ?? {}),
      ...Object.keys(original.visual.colorTokens ?? {}),
    ])) {
      if (!inheritedStyleField(target, baseline, key)) continue;
      const link = (
        original.visual.colorTokens as Record<string, string> | undefined
      )?.[key];
      if (link) nextLinks[key] = link;
      else delete nextLinks[key];
      if (Object.hasOwn(sourceStyle, key))
        nextStyle[key] = (sourceStyle as Record<string, unknown>)[key];
      else delete nextStyle[key];
    }
    for (const key of new Set([
      ...Object.keys(object(baseline["numberTokens"]) ?? {}),
      ...Object.keys(original.visual.numberTokens ?? {}),
    ])) {
      if (!inheritedNumberField(target, baseline, key)) continue;
      const link = (
        original.visual.numberTokens as Record<string, string> | undefined
      )?.[key];
      if (link) nextNumberLinks[key] = link;
      else delete nextNumberLinks[key];
    }
    const nextGeometry: Record<string, unknown> = {};
    let geometryChanged = false;
    const oldGeometry = object(baseline["geometry"]);
    if (semantic.instanceOf && oldGeometry && oldRootGeometry) {
      const sourceGeometry = geometrySnapshot(original);
      for (const field of COMPONENT_GEOMETRY_FIELDS) {
        if (target.id === id && (field === "x" || field === "y")) continue;
        const previous = componentGeometryValue(
          field,
          oldGeometry,
          oldRootGeometry,
          instance,
          target.id === id,
        );
        if (!equal(target.visual[field], previous)) continue;
        const nextValue = componentGeometryValue(
          field,
          sourceGeometry,
          sourceRootGeometry,
          instance,
          target.id === id,
        );
        nextGeometry[field] = nextValue;
        if (!equal(target.visual[field], nextValue)) geometryChanged = true;
      }
    }
    if (
      !equal(currentStyle, nextStyle) ||
      !equal(target.visual.colorTokens ?? {}, nextLinks) ||
      !equal(target.visual.numberTokens ?? {}, nextNumberLinks) ||
      target.visual.textStyle !== nextTextStyle ||
      geometryChanged
    ) {
      const {
        style: _style,
        colorTokens: _links,
        numberTokens: _numberLinks,
        textStyle: _textStyle,
        ...rest
      } = target.visual;
      const geometry = { ...rest } as Record<string, unknown>;
      for (const [field, value] of Object.entries(nextGeometry)) {
        if (value === undefined) delete geometry[field];
        else geometry[field] = value;
      }
      const visual = {
        ...geometry,
        ...(Object.keys(nextLinks).length ? { colorTokens: nextLinks } : {}),
        ...(Object.keys(nextNumberLinks).length
          ? { numberTokens: nextNumberLinks }
          : {}),
        ...(nextTextStyle ? { textStyle: nextTextStyle } : {}),
      };
      commands.push({
        type: "replaceVisual",
        id: target.id,
        visual: Object.keys(nextStyle).length
          ? { ...visual, style: nextStyle as VisualStyle }
          : visual,
      });
    }
    const text = editor.getText(target.id);
    const sourceText = editor.getText(original.id);
    const field = editor.editableField(target.id);
    let nextSemantic = target.semantic;
    const baselineMarks = Array.isArray(baseline["marks"])
      ? normalizeTextMarks(text ?? "", baseline["marks"] as TextMark[])
      : [];
    if (field && sourceText !== null && text === baseline["text"]) {
      let next = {
        ...(target.semantic as object),
        [field]: sourceText,
      } as Record<string, unknown>;
      if (target.type === "text.note") {
        const currentMarks = textNoteMarks(target.semantic);
        const sourceMarks = textNoteMarks(original.semantic);
        const nextMarks = equal(currentMarks, baselineMarks)
          ? sourceMarks
          : rebaseTextMarks(text ?? "", sourceText, currentMarks);
        if (nextMarks.length) next["marks"] = nextMarks;
        else {
          const { marks: _marks, ...withoutMarks } = next;
          next = withoutMarks;
        }
      }
      nextSemantic = next;
    } else if (target.type === "text.note" && text === baseline["text"]) {
      const currentMarks = textNoteMarks(target.semantic);
      const sourceMarks = textNoteMarks(original.semantic);
      if (
        equal(currentMarks, baselineMarks) &&
        !equal(currentMarks, sourceMarks)
      ) {
        let next = { ...(target.semantic as TextNoteSemantic) } as Record<
          string,
          unknown
        >;
        if (sourceMarks.length) next["marks"] = sourceMarks;
        else {
          const { marks: _marks, ...withoutMarks } = next;
          next = withoutMarks;
        }
        nextSemantic = next;
      }
    }
    if (!equal(nextSemantic, target.semantic)) {
      if (target.id === id) rootSemantic = nextSemantic;
      else
        commands.push({
          type: "updateSemantic",
          id: target.id,
          semantic: nextSemantic,
        });
    }
    bindings.push({ ...binding, baseline: snapshot(editor, original) });
  }
  const next = { ...(rootSemantic as object), instanceBindings: bindings };
  if (!equal(next, semantic))
    commands.push({ type: "updateSemantic", id, semantic: next });
  return commands;
}
