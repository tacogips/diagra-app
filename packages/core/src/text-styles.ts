import type {
  Element,
  TextStyleSemantic,
  TypographyStyleValue,
  Visual,
  VisualStyle,
} from "@diagra/ir";
import { applyCommands, type Command } from "./commands.ts";
import { Editor } from "./editor.ts";
import { leafElements } from "./group.ts";
import type { ShapeUtilRegistry } from "./shape-util.ts";
import type { Store } from "./store.ts";

export const TYPOGRAPHY_FIELDS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariations",
  "fontFeatures",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textDecoration",
  "verticalAlign",
] as const satisfies readonly (keyof TypographyStyleValue)[];

export const DEFAULT_TYPOGRAPHY_STYLE: TypographyStyleValue = {
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
  fontWeight: 400,
  fontStyle: "normal",
  lineHeight: 1.35,
  letterSpacing: 0,
  textAlign: "start",
  textDecoration: "none",
  verticalAlign: "top",
};

function isTextStyle(
  element: Element | undefined,
): element is Element<TextStyleSemantic> {
  return element?.type === "design.text-style";
}

function validTypography(value: TypographyStyleValue): boolean {
  return (
    typeof value?.fontFamily === "string" &&
    value.fontFamily.trim().length > 0 &&
    Number.isFinite(value.fontSize) &&
    value.fontSize >= 1 &&
    Number.isFinite(value.fontWeight) &&
    value.fontWeight >= 1 &&
    value.fontWeight <= 1000 &&
    (value.fontStyle === "normal" || value.fontStyle === "italic") &&
    validFontSettings(value.fontVariations) &&
    validFontSettings(value.fontFeatures, true) &&
    Number.isFinite(value.lineHeight) &&
    value.lineHeight >= 0.1 &&
    Number.isFinite(value.letterSpacing) &&
    (["start", "middle", "end"] as const).includes(value.textAlign) &&
    (
      ["none", "underline", "line-through", "underline line-through"] as const
    ).includes(value.textDecoration) &&
    (["top", "middle", "bottom"] as const).includes(value.verticalAlign)
  );
}

function validFontSettings(
  settings:
    | readonly { readonly tag: string; readonly value: number }[]
    | undefined,
  integer = false,
): boolean {
  if (settings === undefined) return true;
  return (
    settings.length <= 16 &&
    new Set(settings.map((setting) => setting.tag)).size === settings.length &&
    settings.every(
      (setting) =>
        /^[A-Za-z0-9]{4}$/.test(setting.tag) &&
        Number.isFinite(setting.value) &&
        (!integer || (Number.isInteger(setting.value) && setting.value >= 0)),
    )
  );
}

function textBearing(editor: Editor, element: Element): boolean {
  return editor.editableField(element.id) !== null;
}

export function typographyOf(
  style: VisualStyle | undefined,
): TypographyStyleValue {
  return Object.fromEntries(
    TYPOGRAPHY_FIELDS.map((field) => [
      field,
      style?.[field] ?? DEFAULT_TYPOGRAPHY_STYLE[field],
    ]),
  ) as unknown as TypographyStyleValue;
}

export function selectionTypography(
  editor: Editor,
): TypographyStyleValue | null {
  const element = leafElements(editor.store, editor.selection.ids()).find(
    (leaf) => textBearing(editor, leaf),
  );
  return element ? typographyOf(element.visual.style) : null;
}

export function textStyles(editor: Editor) {
  return editor
    .getSnapshot()
    .elements.filter(isTextStyle)
    .map((element) => ({
      id: element.id,
      page: element.page,
      name: element.semantic.name,
      value: element.semantic.value,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function createTextStyle(
  editor: Editor,
  name: string,
  value: TypographyStyleValue = selectionTypography(editor) ??
    DEFAULT_TYPOGRAPHY_STYLE,
): string | null {
  if (!name.trim() || !validTypography(value)) return null;
  const element = editor.buildElement("design.text-style", {
    semantic: { name: name.trim(), value },
  });
  editor.apply([{ type: "createElement", element }]);
  return element.id;
}

export function updateTextStyle(
  editor: Editor,
  id: string,
  name: string,
  value: TypographyStyleValue,
): boolean {
  const element = editor.store.get(id);
  if (
    !isTextStyle(element) ||
    editor.createShapeContext().isLocked?.(id) ||
    !name.trim() ||
    !validTypography(value)
  )
    return false;
  const semantic: TextStyleSemantic = { name: name.trim(), value };
  if (JSON.stringify(element.semantic) === JSON.stringify(semantic))
    return false;
  editor.apply([{ type: "updateSemantic", id, semantic }]);
  return true;
}

export function selectionTextStyleBinding(editor: Editor) {
  const context = editor.createShapeContext();
  const elements = leafElements(editor.store, editor.selection.ids()).filter(
    (element) => textBearing(editor, element),
  );
  const ids = elements.map((element) => element.visual.textStyle ?? null);
  const id = ids[0] ?? null;
  const mixed = ids.some((candidate) => candidate !== id);
  const resource = id ? editor.store.get(id) : undefined;
  const semantic = isTextStyle(resource) ? resource.semantic : null;
  return {
    count: elements.length,
    editable: elements.filter((element) => !context.isLocked?.(element.id))
      .length,
    mixed,
    id: mixed ? null : id,
    name: mixed ? null : (semantic?.name ?? null),
    missing: !mixed && id !== null && semantic === null,
    deferred: elements.filter((element) => {
      const linked = element.visual.textStyle;
      const token = linked ? editor.store.get(linked) : undefined;
      if (!linked || !isTextStyle(token)) return Boolean(linked);
      return TYPOGRAPHY_FIELDS.some(
        (field) =>
          JSON.stringify(
            element.visual.style?.[field] ?? DEFAULT_TYPOGRAPHY_STYLE[field],
          ) !== JSON.stringify(token.semantic.value[field]),
      );
    }).length,
  };
}

/** Apply or detach a complete text style while retaining portable literals. */
export function bindSelectionTextStyle(
  editor: Editor,
  id: string | null,
): boolean {
  const resource = id ? editor.store.get(id) : undefined;
  if (id && !isTextStyle(resource)) return false;
  const context = editor.createShapeContext();
  const commands: Command[] = [];
  for (const element of leafElements(editor.store, editor.selection.ids())) {
    if (!textBearing(editor, element) || context.isLocked?.(element.id))
      continue;
    const {
      textStyle: _link,
      numberTokens: oldNumbers,
      ...rest
    } = element.visual;
    const {
      fontSize: _fontSize,
      letterSpacing: _letterSpacing,
      ...typographyIndependentNumbers
    } = oldNumbers ?? {};
    const numbers = resource ? typographyIndependentNumbers : { ...oldNumbers };
    const style: Record<string, unknown> = { ...(rest.style ?? {}) };
    if (resource && isTextStyle(resource))
      for (const field of TYPOGRAPHY_FIELDS) {
        const value = resource.semantic.value[field];
        if (value === undefined) delete style[field];
        else style[field] = value;
      }
    const visual: Visual = {
      ...rest,
      ...(Object.keys(numbers).length ? { numberTokens: numbers } : {}),
      ...(Object.keys(style).length ? { style: style as VisualStyle } : {}),
      ...(id ? { textStyle: id } : {}),
    };
    if (JSON.stringify(visual) !== JSON.stringify(element.visual))
      commands.push({ type: "replaceVisual", id: element.id, visual });
  }
  if (!commands.length) return false;
  editor.apply(commands);
  return true;
}

/** Materialize linked typography and detach missing/wrong-kind resources. */
export function planTextStyles(
  store: Store,
  registry: ShapeUtilRegistry,
): Command[] {
  if (!store.getSnapshot().elements.some((element) => element.visual.textStyle))
    return [];
  const editor = new Editor({ document: store.getSnapshot(), registry });
  const context = editor.createShapeContext();
  const commands: Command[] = [];
  for (const element of store.getSnapshot().elements) {
    const id = element.visual.textStyle;
    if (!id || context.isLocked?.(element.id)) continue;
    const resource = store.get(id);
    const {
      textStyle: _link,
      numberTokens: oldNumbers,
      ...rest
    } = element.visual;
    if (!isTextStyle(resource) || !textBearing(editor, element)) {
      commands.push({
        type: "replaceVisual",
        id: element.id,
        visual: {
          ...rest,
          ...(oldNumbers ? { numberTokens: oldNumbers } : {}),
        },
      });
      continue;
    }
    const {
      fontSize: _fontSize,
      letterSpacing: _letterSpacing,
      ...numbers
    } = oldNumbers ?? {};
    const style: Record<string, unknown> = { ...(rest.style ?? {}) };
    for (const field of TYPOGRAPHY_FIELDS) {
      const value = resource.semantic.value[field];
      if (value === undefined) delete style[field];
      else style[field] = value;
    }
    const visual: Visual = {
      ...rest,
      ...(Object.keys(numbers).length ? { numberTokens: numbers } : {}),
      textStyle: id,
      style: style as VisualStyle,
    };
    if (JSON.stringify(visual) !== JSON.stringify(element.visual))
      commands.push({ type: "replaceVisual", id: element.id, visual });
  }
  if (commands.length) applyCommands(store, commands);
  return commands;
}
