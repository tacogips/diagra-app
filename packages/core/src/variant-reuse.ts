import type {
  Element,
  ElementId,
  FrameSemantic,
  VisualStyle,
} from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { componentOverrides } from "./component-overrides.ts";
import { expandContainers } from "./frame-tree.ts";

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

/** Reject ambiguous keys instead of silently moving overrides to another layer. */
export function variantReuse(
  editor: Editor,
  instance: Element,
  source: Element,
  elements: readonly Element[],
): Map<ElementId, ElementId> | null {
  const targets = new Set(
    expandContainers(editor.store, [instance.id], editor.createShapeContext()),
  );
  const old = new Map<string, Element>();
  const direct = new Map<ElementId, Element>();
  for (const binding of (instance.semantic as FrameSemantic).instanceBindings ??
    []) {
    const original = binding.source
      ? editor.store.get(binding.source)
      : undefined;
    const target = binding.target
      ? editor.store.get(binding.target)
      : undefined;
    const key = original?.visual.componentKey;
    if (!target || !targets.has(target.id)) continue;
    // A malformed comparison snapshot cannot safely preserve customizations.
    try {
      const baseline = JSON.parse(binding.baseline);
      if (
        !baseline ||
        typeof baseline !== "object" ||
        !baseline.style ||
        typeof baseline.style !== "object" ||
        Array.isArray(baseline.style)
      )
        return null;
    } catch {
      return null;
    }
    if (!original || target.id === instance.id) continue;
    if (direct.has(original.id)) return null;
    direct.set(original.id, target);
    if (!key) continue;
    if (old.has(key)) return null;
    old.set(key, target);
  }
  const mapping = new Map([[source.id, instance.id]]);
  const keys = new Set<string>();
  const reused = new Set([instance.id]);
  for (const element of elements) {
    if (element.id === source.id) continue;
    const key = element.visual.componentKey;
    if (key && keys.has(key)) return null;
    if (key) keys.add(key);
    const target = direct.get(element.id) ?? (key ? old.get(key) : undefined);
    if (!target || target.type !== element.type) continue;
    if (reused.has(target.id)) return null;
    reused.add(target.id);
    mapping.set(element.id, target.id);
  }
  return mapping;
}

/** Only explicit text/style overrides carry across; new variant owns geometry. */
export function carryVariantOverrides(
  editor: Editor,
  instanceId: ElementId,
  element: Element,
): Element {
  let semantic = element.semantic;
  const geometry = new Map<string, unknown>();
  const style: Record<string, unknown> = { ...element.visual.style };
  const links: Record<string, string> = { ...element.visual.colorTokens };
  const numberLinks: Record<string, string> = {
    ...element.visual.numberTokens,
  };
  let textStyle = element.visual.textStyle;
  for (const override of componentOverrides(editor, element.id)) {
    if (override.instanceId !== instanceId) continue;
    if (override.field === "text") {
      const field = editor.editableField(element.id);
      if (field)
        semantic = { ...(semantic as object), [field]: override.current };
    } else if (override.field.startsWith("style.")) {
      const key = override.field.slice("style.".length);
      if (TYPOGRAPHY_STYLE_FIELDS.has(key))
        textStyle = editor.store.get(element.id)?.visual.textStyle;
      const link = (
        editor.store.get(element.id)?.visual.colorTokens as
          | Record<string, string>
          | undefined
      )?.[key];
      if (link) links[key] = link;
      else delete links[key];
      const numberLink = (
        editor.store.get(element.id)?.visual.numberTokens as
          | Record<string, string>
          | undefined
      )?.[key];
      if (numberLink) numberLinks[key] = numberLink;
      else delete numberLinks[key];
      if (override.current === undefined) delete style[key];
      else
        Object.defineProperty(style, key, {
          value: override.current,
          enumerable: true,
          configurable: true,
        });
    } else if (override.field.startsWith("measurement.")) {
      const key = override.field.slice("measurement.".length);
      const link = (
        editor.store.get(element.id)?.visual.numberTokens as
          | Record<string, string>
          | undefined
      )?.[key];
      if (link) numberLinks[key] = link;
      else delete numberLinks[key];
    } else if (override.field.startsWith("geometry.")) {
      const key = override.field.slice("geometry.".length);
      geometry.set(key, override.current);
    }
  }
  const {
    style: _style,
    colorTokens: _links,
    numberTokens: _numberLinks,
    textStyle: _textStyle,
    ...rest
  } = element.visual;
  const visual: Record<string, unknown> = {
    ...rest,
    ...(Object.keys(links).length ? { colorTokens: links } : {}),
    ...(Object.keys(numberLinks).length ? { numberTokens: numberLinks } : {}),
    ...(textStyle ? { textStyle } : {}),
  };
  for (const [field, value] of geometry) {
    if (value === undefined) delete visual[field];
    else visual[field] = value;
  }
  return {
    ...element,
    semantic,
    visual: Object.keys(style).length
      ? ({ ...visual, style: style as VisualStyle } as Element["visual"])
      : (visual as Element["visual"]),
  };
}
