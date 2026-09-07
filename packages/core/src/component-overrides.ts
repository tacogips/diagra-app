import type {
  ElementId,
  FrameSemantic,
  TextMark,
  VisualStyle,
} from "@diagra/ir";
import type { Command } from "./commands.ts";
import {
  COMPONENT_GEOMETRY_FIELDS,
  componentGeometryValue,
  componentValuesEqual,
  inheritedNumberField,
  inheritedStyleField,
} from "./component-refresh.ts";
import type { Editor } from "./editor.ts";
import { expandContainers } from "./frame-tree.ts";
import {
  normalizeTextMarks,
  rebaseTextMarks,
  textNoteMarks,
} from "./rich-text.ts";

export interface ComponentOverride {
  readonly instanceId: ElementId;
  readonly targetId: ElementId;
  readonly sourceId: ElementId;
  readonly field: string;
  readonly current: unknown;
  readonly source: unknown;
  readonly locked: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const STYLE_MEASUREMENTS = new Set([
  "cornerRadius",
  "cornerTopLeft",
  "cornerTopRight",
  "cornerBottomRight",
  "cornerBottomLeft",
  "strokeWidth",
  "fontSize",
  "letterSpacing",
]);

/** Return local overrides, not inherited values merely awaiting a refresh. */
export function componentOverrides(
  editor: Editor,
  targetId: ElementId,
): ComponentOverride[] {
  const target = editor.store.get(targetId);
  if (!target) return [];
  const context = editor.createShapeContext();
  const result: ComponentOverride[] = [];
  for (const instance of editor.store.getPageElements(target.page)) {
    if (instance.type !== "frame") continue;
    const semantic = instance.semantic as FrameSemantic;
    const sourceId = semantic.instanceOf ?? semantic.responsiveSource;
    const source = sourceId ? editor.store.get(sourceId) : undefined;
    if (
      !source ||
      source.type !== "frame" ||
      (semantic.instanceOf !== undefined &&
        !(source.semantic as FrameSemantic).component)
    )
      continue;
    const bindings = semantic.instanceBindings?.filter(
      (binding) => binding.target === targetId,
    );
    if (bindings?.length !== 1) continue;
    const binding = bindings[0];
    const original = binding?.source
      ? editor.store.get(binding.source)
      : undefined;
    if (!binding || !original || original.type !== target.type) continue;
    const targets = expandContainers(editor.store, [instance.id], context);
    const sources = expandContainers(editor.store, [source.id], context);
    if (
      !targets.includes(targetId) ||
      !sources.includes(original.id) ||
      targets.includes(source.id) ||
      sources.includes(instance.id)
    )
      continue;
    let baseline: Record<string, unknown> | null;
    try {
      baseline = record(JSON.parse(binding.baseline));
    } catch {
      continue;
    }
    const oldStyle = record(baseline?.["style"]);
    if (!baseline || !oldStyle) continue;
    const add = (
      field: string,
      current: unknown,
      previous: unknown,
      sourceValue: unknown,
    ): void => {
      if (componentValuesEqual(current, previous)) return;
      result.push({
        instanceId: instance.id,
        targetId,
        sourceId: original.id,
        field,
        current,
        source: sourceValue,
        locked: Boolean(
          context.isLocked?.(instance.id) || context.isLocked?.(targetId),
        ),
      });
    };
    if (editor.editableField(targetId))
      add(
        "text",
        editor.getText(targetId),
        baseline["text"],
        editor.getText(original.id),
      );
    if (target.type === "text.note")
      add(
        "marks",
        textNoteMarks(target.semantic),
        baseline["marks"] ?? [],
        textNoteMarks(original.semantic),
      );
    const style = target.visual.style ?? {};
    for (const key of new Set([
      ...Object.keys(oldStyle),
      ...Object.keys(style),
      ...Object.keys(record(baseline["colorTokens"]) ?? {}),
      ...Object.keys(target.visual.colorTokens ?? {}),
    ])) {
      if (!inheritedStyleField(target, baseline, key))
        result.push({
          instanceId: instance.id,
          targetId,
          sourceId: original.id,
          field: `style.${key}`,
          current: (style as Record<string, unknown>)[key],
          source: (
            original.visual.style as Record<string, unknown> | undefined
          )?.[key],
          locked: Boolean(
            context.isLocked?.(instance.id) || context.isLocked?.(targetId),
          ),
        });
    }
    const oldNumbers = record(baseline["numberTokens"]) ?? {};
    for (const key of new Set([
      ...Object.keys(oldNumbers),
      ...Object.keys(target.visual.numberTokens ?? {}),
    ])) {
      if (STYLE_MEASUREMENTS.has(key)) continue;
      if (!inheritedNumberField(target, baseline, key))
        result.push({
          instanceId: instance.id,
          targetId,
          sourceId: original.id,
          field: `measurement.${key}`,
          current: (
            target.visual.numberTokens as Record<string, unknown> | undefined
          )?.[key],
          source: (
            original.visual.numberTokens as Record<string, unknown> | undefined
          )?.[key],
          locked: Boolean(
            context.isLocked?.(instance.id) || context.isLocked?.(targetId),
          ),
        });
    }
    if (semantic.instanceOf) {
      const rootBinding = semantic.instanceBindings?.find(
        (item) => item.source === source.id && item.target === instance.id,
      );
      let rootBaseline: Record<string, unknown> | null = null;
      try {
        rootBaseline = rootBinding
          ? record(JSON.parse(rootBinding.baseline))
          : null;
      } catch {
        rootBaseline = null;
      }
      const oldGeometry = record(baseline["geometry"]);
      const oldRootGeometry = record(rootBaseline?.["geometry"]);
      if (oldGeometry && oldRootGeometry) {
        const sourceGeometry = Object.fromEntries(
          COMPONENT_GEOMETRY_FIELDS.flatMap((field) => {
            const value = original.visual[field];
            return value === undefined ? [] : [[field, value]];
          }),
        );
        const sourceRootGeometry = Object.fromEntries(
          COMPONENT_GEOMETRY_FIELDS.flatMap((field) => {
            const value = source.visual[field];
            return value === undefined ? [] : [[field, value]];
          }),
        );
        for (const field of COMPONENT_GEOMETRY_FIELDS) {
          if (targetId === instance.id && (field === "x" || field === "y"))
            continue;
          const previous = componentGeometryValue(
            field,
            oldGeometry,
            oldRootGeometry,
            instance,
            targetId === instance.id,
          );
          if (componentValuesEqual(target.visual[field], previous)) continue;
          result.push({
            instanceId: instance.id,
            targetId,
            sourceId: original.id,
            field: `geometry.${field}`,
            current: target.visual[field],
            source: componentGeometryValue(
              field,
              sourceGeometry,
              sourceRootGeometry,
              instance,
              targetId === instance.id,
            ),
            locked: Boolean(
              context.isLocked?.(instance.id) || context.isLocked?.(targetId),
            ),
          });
        }
      }
    }
  }
  return result;
}

export function planResetComponentOverride(
  editor: Editor,
  instanceId: ElementId,
  targetId: ElementId,
  field: string,
): Command[] | null {
  const override = componentOverrides(editor, targetId).find(
    (item) => item.instanceId === instanceId && item.field === field,
  );
  if (!override || override.locked) return null;
  const instance = editor.store.get(instanceId);
  const target = editor.store.get(targetId);
  if (!instance || !target) return null;
  const semantic = instance.semantic as FrameSemantic;
  const binding = semantic.instanceBindings?.find(
    (item) => item.target === targetId,
  );
  if (!binding) return null;
  const baseline = JSON.parse(binding.baseline) as Record<string, unknown>;
  const commands: Command[] = [];
  let rootSemantic: unknown = semantic;
  if (field === "text") {
    const key = editor.editableField(targetId);
    if (!key || typeof override.source !== "string") return null;
    let next = {
      ...(target.semantic as object),
      [key]: override.source,
    } as Record<string, unknown>;
    if (target.type === "text.note") {
      const currentText = editor.getText(targetId) ?? "";
      const currentMarks = textNoteMarks(target.semantic);
      const oldMarks = Array.isArray(baseline["marks"])
        ? normalizeTextMarks(currentText, baseline["marks"] as TextMark[])
        : [];
      const sourceElement = editor.store.get(override.sourceId);
      const sourceMarks =
        sourceElement?.type === "text.note"
          ? textNoteMarks(sourceElement.semantic)
          : [];
      const marks = componentValuesEqual(currentMarks, oldMarks)
        ? sourceMarks
        : rebaseTextMarks(currentText, override.source, currentMarks);
      if (marks.length) next["marks"] = marks;
      else {
        const { marks: _marks, ...withoutMarks } = next;
        next = withoutMarks;
      }
      if (componentValuesEqual(currentMarks, oldMarks))
        baseline["marks"] = marks;
    }
    if (targetId === instanceId) rootSemantic = next;
    else
      commands.push({ type: "updateSemantic", id: targetId, semantic: next });
    baseline["text"] = override.source;
  } else if (field === "marks") {
    if (target.type !== "text.note") return null;
    const source = editor.store.get(override.sourceId);
    if (source?.type !== "text.note") return null;
    const text = editor.getText(targetId) ?? "";
    const marks = normalizeTextMarks(text, textNoteMarks(source.semantic));
    let next = { ...(target.semantic as object) } as Record<string, unknown>;
    if (marks.length) next["marks"] = marks;
    else {
      const { marks: _marks, ...withoutMarks } = next;
      next = withoutMarks;
    }
    if (targetId === instanceId) rootSemantic = next;
    else
      commands.push({ type: "updateSemantic", id: targetId, semantic: next });
    baseline["marks"] = marks;
  } else if (field.startsWith("style.")) {
    const key = field.slice("style.".length);
    const next = { ...target.visual.style } as Record<string, unknown>;
    const oldStyle = { ...(baseline["style"] as object) } as Record<
      string,
      unknown
    >;
    if (override.source === undefined) {
      delete next[key];
      delete oldStyle[key];
    } else {
      Object.defineProperty(next, key, {
        value: override.source,
        enumerable: true,
        configurable: true,
      });
      Object.defineProperty(oldStyle, key, {
        value: override.source,
        enumerable: true,
        configurable: true,
      });
    }
    const {
      style: _style,
      colorTokens: _links,
      numberTokens: _numberLinks,
      ...rest
    } = target.visual;
    const links: Record<string, string> = { ...target.visual.colorTokens };
    const oldLinks = { ...record(baseline["colorTokens"]) };
    const numberLinks: Record<string, string> = {
      ...target.visual.numberTokens,
    };
    const oldNumberLinks = { ...record(baseline["numberTokens"]) };
    const sourceLink = (
      editor.store.get(override.sourceId)?.visual.colorTokens as
        | Record<string, string>
        | undefined
    )?.[key];
    if (sourceLink) {
      links[key] = sourceLink;
      oldLinks[key] = sourceLink;
    } else {
      delete links[key];
      delete oldLinks[key];
    }
    baseline["colorTokens"] = oldLinks;
    const sourceNumberLink = (
      editor.store.get(override.sourceId)?.visual.numberTokens as
        | Record<string, string>
        | undefined
    )?.[key];
    if (sourceNumberLink) {
      numberLinks[key] = sourceNumberLink;
      oldNumberLinks[key] = sourceNumberLink;
    } else {
      delete numberLinks[key];
      delete oldNumberLinks[key];
    }
    if (key === "cornerRadii") {
      const sourceNumberLinks = editor.store.get(override.sourceId)?.visual
        .numberTokens as Record<string, string> | undefined;
      for (const cornerField of [
        "cornerTopLeft",
        "cornerTopRight",
        "cornerBottomRight",
        "cornerBottomLeft",
      ]) {
        const link = sourceNumberLinks?.[cornerField];
        if (link) {
          numberLinks[cornerField] = link;
          oldNumberLinks[cornerField] = link;
        } else {
          delete numberLinks[cornerField];
          delete oldNumberLinks[cornerField];
        }
      }
    }
    baseline["numberTokens"] = oldNumberLinks;
    const visual = {
      ...rest,
      ...(Object.keys(links).length ? { colorTokens: links } : {}),
      ...(Object.keys(numberLinks).length ? { numberTokens: numberLinks } : {}),
    };
    commands.push({
      type: "replaceVisual",
      id: targetId,
      visual: Object.keys(next).length
        ? { ...visual, style: next as VisualStyle }
        : visual,
    });
    baseline["style"] = oldStyle;
  } else if (field.startsWith("measurement.")) {
    const key = field.slice("measurement.".length);
    const { numberTokens: _numbers, ...rest } = target.visual;
    const links: Record<string, string> = { ...target.visual.numberTokens };
    const oldLinks = { ...record(baseline["numberTokens"]) };
    const sourceLink = (
      editor.store.get(override.sourceId)?.visual.numberTokens as
        | Record<string, string>
        | undefined
    )?.[key];
    if (sourceLink) {
      links[key] = sourceLink;
      oldLinks[key] = sourceLink;
    } else {
      delete links[key];
      delete oldLinks[key];
    }
    baseline["numberTokens"] = oldLinks;
    commands.push({
      type: "replaceVisual",
      id: targetId,
      visual: {
        ...rest,
        ...(Object.keys(links).length ? { numberTokens: links } : {}),
      },
    });
  } else if (field.startsWith("geometry.")) {
    if (!(semantic as FrameSemantic).instanceOf) return null;
    const key = field.slice("geometry.".length);
    if (!(COMPONENT_GEOMETRY_FIELDS as readonly string[]).includes(key))
      return null;
    const geometryKey = key as (typeof COMPONENT_GEOMETRY_FIELDS)[number];
    if (targetId === instanceId && (geometryKey === "x" || geometryKey === "y"))
      return null;
    let visual = { ...target.visual } as Record<string, unknown>;
    if (override.source === undefined) delete visual[geometryKey];
    else visual[geometryKey] = override.source;
    if (geometryKey === "width" || geometryKey === "height") {
      const links = { ...target.visual.numberTokens } as Record<string, string>;
      const baselineLinks = {
        ...record(baseline["numberTokens"]),
      } as Record<string, string>;
      const sourceLink = editor.store.get(override.sourceId)?.visual
        .numberTokens?.[geometryKey];
      if (sourceLink) {
        links[geometryKey] = sourceLink;
        baselineLinks[geometryKey] = sourceLink;
      } else {
        delete links[geometryKey];
        delete baselineLinks[geometryKey];
      }
      if (Object.keys(links).length) visual["numberTokens"] = links;
      else {
        const { numberTokens: _links, ...withoutLinks } = visual;
        visual = withoutLinks;
      }
      baseline["numberTokens"] = baselineLinks;
    }
    commands.push({
      type: "replaceVisual",
      id: targetId,
      visual,
    });
    const oldGeometry = record(baseline["geometry"]);
    const source = editor.store.get(override.sourceId);
    if (!oldGeometry || !source) return null;
    const sourceValue = source.visual[geometryKey];
    if (sourceValue === undefined) delete oldGeometry[geometryKey];
    else oldGeometry[geometryKey] = sourceValue;
    baseline["geometry"] = oldGeometry;
  } else {
    return null;
  }
  commands.push({
    type: "updateSemantic",
    id: instanceId,
    semantic: {
      ...(rootSemantic as object),
      instanceBindings: semantic.instanceBindings?.map((item) =>
        item === binding
          ? { ...item, baseline: JSON.stringify(baseline) }
          : item,
      ),
    },
  });
  return commands;
}
