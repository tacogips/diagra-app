import type {
  CornerRadii,
  Element,
  FrameSemantic,
  NumberTokenSemantic,
  Visual,
} from "@diagra/ir";
import { applyCommands, type Command } from "./commands.ts";
import { Editor } from "./editor.ts";
import { leafElements } from "./group.ts";
import { frameParents } from "./frame-tree.ts";
import type { ShapeUtilRegistry } from "./shape-util.ts";
import type { Store } from "./store.ts";
import { textOwnsAxis } from "./text-layout.ts";
import {
  activeTokenAlias,
  pageTokenMode,
  resolveNumberToken,
} from "./token-values.ts";

export const NUMBER_FIELDS = [
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "cornerRadius",
  "cornerTopLeft",
  "cornerTopRight",
  "cornerBottomRight",
  "cornerBottomLeft",
  "strokeWidth",
  "fontSize",
  "letterSpacing",
  "gap",
  "crossGap",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;
export type NumberField = (typeof NUMBER_FIELDS)[number];

export const SIZE_FIELDS = ["width", "height"] as const;
export const SIZE_LIMIT_FIELDS = [
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
] as const;
export const STYLE_NUMBER_FIELDS = [
  "cornerRadius",
  "strokeWidth",
  "fontSize",
  "letterSpacing",
] as const;
export const CORNER_NUMBER_FIELDS = [
  "cornerTopLeft",
  "cornerTopRight",
  "cornerBottomRight",
  "cornerBottomLeft",
] as const;
export type CornerNumberField = (typeof CORNER_NUMBER_FIELDS)[number];
export const CORNER_STYLE_FIELDS: Readonly<
  Record<CornerNumberField, keyof CornerRadii>
> = {
  cornerTopLeft: "topLeft",
  cornerTopRight: "topRight",
  cornerBottomRight: "bottomRight",
  cornerBottomLeft: "bottomLeft",
};
export const LAYOUT_NUMBER_FIELDS = [
  "gap",
  "crossGap",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

function isNumberToken(
  element: Element | undefined,
): element is Element & { readonly semantic: NumberTokenSemantic } {
  return (
    element?.type === "design.token" &&
    (element.semantic as { kind?: unknown }).kind === "number"
  );
}

function supportsSizeLimits(editor: Editor, element: Element): boolean {
  if (
    element.visual.textResize === "auto-width" ||
    element.visual.textResize === "auto-height" ||
    (element.type === "frame" &&
      Boolean((element.semantic as FrameSemantic).layout))
  )
    return true;
  const context = editor.createShapeContext();
  const parentId = frameParents(editor.store, element.page, context).get(
    element.id,
  );
  const parent = parentId ? editor.store.get(parentId) : undefined;
  return Boolean(
    parent?.type === "frame" && (parent.semantic as FrameSemantic).layout,
  );
}

function applicable(editor: Editor, element: Element, field: NumberField) {
  if (element.type === "design.token" || element.type === "design.text-style")
    return false;
  if ((SIZE_FIELDS as readonly string[]).includes(field)) {
    if (textOwnsAxis(element, field as "width" | "height")) return false;
    const util = editor.getShapeUtil(element.type);
    return (
      util.canResize && Boolean(util.resize && editor.getBounds(element.id))
    );
  }
  if ((SIZE_LIMIT_FIELDS as readonly string[]).includes(field)) {
    const util = editor.getShapeUtil(element.type);
    return (
      supportsSizeLimits(editor, element) &&
      util.canResize &&
      Boolean(util.resize && editor.getBounds(element.id))
    );
  }
  if (field === "cornerRadius") return !element.visual.style?.cornerRadii;
  if ((CORNER_NUMBER_FIELDS as readonly string[]).includes(field))
    return Boolean(element.visual.style?.cornerRadii);
  if ((LAYOUT_NUMBER_FIELDS as readonly string[]).includes(field)) {
    return (
      element.type === "frame" &&
      Boolean((element.semantic as FrameSemantic).layout)
    );
  }
  return true;
}

function currentValue(editor: Editor, element: Element, field: NumberField) {
  if ((SIZE_FIELDS as readonly string[]).includes(field))
    return editor.getBounds(element.id)?.[field as "width" | "height"];
  if ((SIZE_LIMIT_FIELDS as readonly string[]).includes(field))
    return element.visual[field as (typeof SIZE_LIMIT_FIELDS)[number]];
  if ((STYLE_NUMBER_FIELDS as readonly string[]).includes(field))
    return element.visual.style?.[
      field as (typeof STYLE_NUMBER_FIELDS)[number]
    ];
  if ((CORNER_NUMBER_FIELDS as readonly string[]).includes(field))
    return element.visual.style?.cornerRadii?.[
      CORNER_STYLE_FIELDS[field as CornerNumberField]
    ];
  return (element.semantic as FrameSemantic).layout?.[
    field as (typeof LAYOUT_NUMBER_FIELDS)[number]
  ];
}

/** Inspect only fields that apply to at least one selected leaf. */
export function selectionNumberBindings(editor: Editor) {
  const leaves = leafElements(editor.store, editor.selection.ids());
  const context = editor.createShapeContext();
  return NUMBER_FIELDS.flatMap((field) => {
    const candidates = leaves.filter((element) =>
      applicable(editor, element, field),
    );
    if (!candidates.length) return [];
    const links = candidates.map(
      (element) => element.visual.numberTokens?.[field] ?? null,
    );
    const tokenId = links[0] ?? null;
    const mixed = links.some((link) => link !== tokenId);
    const token = tokenId ? editor.store.get(tokenId) : undefined;
    const semantic = isNumberToken(token)
      ? (token?.semantic as NumberTokenSemantic)
      : null;
    const resolved =
      tokenId && candidates[0]
        ? resolveNumberToken(editor.store, tokenId, candidates[0].page)
        : null;
    return [
      {
        field,
        count: candidates.length,
        editable: candidates.filter(
          (element) => !context.isLocked?.(element.id),
        ).length,
        mixed,
        tokenId: mixed ? null : tokenId,
        name: mixed ? null : (semantic?.name ?? null),
        value: mixed ? null : (resolved?.value ?? semantic?.value ?? null),
        missing: !mixed && tokenId !== null && semantic === null,
        deferred: candidates.filter((element) => {
          const id = element.visual.numberTokens?.[field];
          const resource = id ? editor.store.get(id) : undefined;
          return Boolean(
            id &&
              (!isNumberToken(resource) ||
                currentValue(editor, element, field) !==
                  resolveNumberToken(editor.store, id, element.page)?.value),
          );
        }).length,
      },
    ];
  });
}

/** Bind or detach one measurement; detaching retains its materialized value. */
export function bindSelectionNumber(
  editor: Editor,
  field: NumberField,
  tokenId: string | null,
): boolean {
  const token = tokenId ? editor.store.get(tokenId) : undefined;
  if (tokenId && !isNumberToken(token)) return false;
  const context = editor.createShapeContext();
  const commands: Command[] = [];
  for (const leaf of leafElements(editor.store, editor.selection.ids())) {
    if (!applicable(editor, leaf, field) || context.isLocked?.(leaf.id))
      continue;
    const { numberTokens: old, textStyle, ...rest } = leaf.visual;
    const links = { ...old };
    if (tokenId) links[field] = tokenId;
    else delete links[field];
    const visual: Visual = {
      ...rest,
      ...(field !== "fontSize" && field !== "letterSpacing" && textStyle
        ? { textStyle }
        : {}),
      ...(Object.keys(links).length ? { numberTokens: links } : {}),
    };
    if (JSON.stringify(visual) !== JSON.stringify(leaf.visual))
      commands.push({ type: "replaceVisual", id: leaf.id, visual });
  }
  if (!commands.length) return false;
  editor.apply(commands);
  return true;
}

/** Materialize numeric resources before auto-layout and constraints run. */
export function planNumberTokens(
  store: Store,
  registry: ShapeUtilRegistry,
): Command[] {
  if (
    !store.getSnapshot().elements.some((element) => element.visual.numberTokens)
  )
    return [];
  const editor = new Editor({ document: store.getSnapshot(), registry });
  const context = editor.createShapeContext();
  const commands: Command[] = [];
  const resolvedValues = new Map<string, Map<string, number | undefined>>();
  const valueFor = (id: string, page: string): number | undefined => {
    let pageValues = resolvedValues.get(page);
    if (!pageValues) {
      pageValues = new Map();
      resolvedValues.set(page, pageValues);
    }
    if (!pageValues.has(id))
      pageValues.set(id, resolveNumberToken(store, id, page)?.value);
    return pageValues.get(id);
  };
  for (const element of store.getSnapshot().elements) {
    if (!element.visual.numberTokens || context.isLocked?.(element.id))
      continue;
    const { numberTokens: old, ...rest } = element.visual;
    const links = { ...old };
    const values = new Map<NumberField, number>();
    for (const field of NUMBER_FIELDS) {
      const id = links[field];
      if (!id) continue;
      const token = store.get(id);
      if (isNumberToken(token) && applicable(editor, element, field)) {
        const value = valueFor(id, element.page);
        if (value !== undefined) values.set(field, value);
        else delete links[field];
      } else delete links[field];
    }

    let visual: Visual = rest;
    for (const field of SIZE_LIMIT_FIELDS) {
      const value = values.get(field);
      if (value !== undefined) visual = { ...visual, [field]: value };
    }
    const bounds = editor.getBounds(element.id);
    const util = registry.getOrFallback(element.type);
    if (
      bounds &&
      util.canResize &&
      util.resize &&
      (values.has("width") || values.has("height"))
    ) {
      const resized = util.resize(element, {
        ...bounds,
        width: values.get("width") ?? bounds.width,
        height: values.get("height") ?? bounds.height,
      });
      visual = { ...visual, ...resized.visual };
    }
    const style = { ...visual.style };
    for (const field of STYLE_NUMBER_FIELDS) {
      const value = values.get(field);
      if (value !== undefined) style[field] = value;
    }
    const cornerRadii = style.cornerRadii
      ? { ...style.cornerRadii }
      : undefined;
    if (cornerRadii) {
      for (const field of CORNER_NUMBER_FIELDS) {
        const value = values.get(field);
        if (value !== undefined)
          cornerRadii[CORNER_STYLE_FIELDS[field]] = value;
      }
      style.cornerRadii = cornerRadii;
    }
    visual = {
      ...visual,
      ...(Object.keys(style).length ? { style } : {}),
      ...(Object.keys(links).length ? { numberTokens: links } : {}),
    };
    if (JSON.stringify(visual) !== JSON.stringify(element.visual))
      commands.push({ type: "replaceVisual", id: element.id, visual });

    if (element.type === "frame") {
      const semantic = element.semantic as FrameSemantic;
      if (semantic.layout) {
        const layout = { ...semantic.layout };
        for (const field of LAYOUT_NUMBER_FIELDS) {
          const value = values.get(field);
          if (value !== undefined) layout[field] = value;
        }
        const next = { ...semantic, layout };
        if (JSON.stringify(next) !== JSON.stringify(semantic))
          commands.push({
            type: "updateSemantic",
            id: element.id,
            semantic: next,
          });
      }
    }
  }
  if (commands.length) applyCommands(store, commands);
  return commands;
}

export function numberTokens(editor: Editor) {
  return editor
    .getSnapshot()
    .elements.filter((element) => isNumberToken(element))
    .map((element) => {
      const semantic = element.semantic as NumberTokenSemantic;
      const resolved = resolveNumberToken(
        editor.store,
        element.id,
        editor.currentPageId,
      );
      return {
        ...semantic,
        baseValue: semantic.value,
        value: resolved?.value ?? semantic.value,
        aliasId: activeTokenAlias(
          semantic,
          pageTokenMode(editor.store, editor.currentPageId),
        ),
        broken: resolved?.broken ?? true,
        id: element.id,
        page: element.page,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function createNumberToken(editor: Editor, name: string, value: number) {
  if (!name.trim() || !Number.isFinite(value) || value < 0) return null;
  const element = editor.buildElement("design.token", {
    semantic: { name: name.trim(), kind: "number", value },
  });
  editor.apply([{ type: "createElement", element }]);
  return element.id;
}

export function updateNumberToken(
  editor: Editor,
  id: string,
  name: string,
  value: number,
): boolean {
  const element = editor.store.get(id);
  if (
    !isNumberToken(element) ||
    editor.createShapeContext().isLocked?.(id) ||
    !name.trim() ||
    !Number.isFinite(value) ||
    value < 0
  )
    return false;
  const semantic: NumberTokenSemantic = {
    ...(element?.semantic as NumberTokenSemantic),
    name: name.trim(),
    kind: "number",
  };
  const current = resolveNumberToken(editor.store, id, editor.currentPageId);
  const next =
    current?.value === value
      ? semantic
      : withNumberTokenChoice(
          semantic,
          pageTokenMode(editor.store, editor.currentPageId),
          { value },
        );
  if (JSON.stringify(element?.semantic) !== JSON.stringify(next))
    editor.apply([{ type: "updateSemantic", id, semantic: next }]);
  return true;
}

function withNumberTokenChoice(
  semantic: NumberTokenSemantic,
  mode: string | undefined,
  choice: { readonly value: number } | { readonly alias: string },
): NumberTokenSemantic {
  if (!mode) {
    const { alias: _alias, ...rest } = semantic;
    return {
      ...rest,
      ...("value" in choice
        ? { value: choice.value }
        : { alias: choice.alias }),
    };
  }
  const modes = [
    ...(Array.isArray(semantic.modes) ? semantic.modes : []).filter(
      (entry) => entry.name !== mode,
    ),
    { name: mode, ...choice },
  ].sort((a, b) => a.name.localeCompare(b.name));
  return { ...semantic, modes };
}

/** Alias the active page mode, or detach it while preserving its appearance. */
export function setNumberTokenAlias(
  editor: Editor,
  id: string,
  targetId: string | null,
): boolean {
  const element = editor.store.get(id);
  if (!isNumberToken(element) || editor.createShapeContext().isLocked?.(id))
    return false;
  const current = resolveNumberToken(editor.store, id, editor.currentPageId);
  if (!current) return false;
  if (targetId) {
    const target = resolveNumberToken(
      editor.store,
      targetId,
      editor.currentPageId,
    );
    if (
      !target ||
      target.broken ||
      targetId === id ||
      target.chain.includes(id)
    )
      return false;
  }
  const semantic = withNumberTokenChoice(
    element.semantic as NumberTokenSemantic,
    pageTokenMode(editor.store, editor.currentPageId),
    targetId ? { alias: targetId } : { value: current.value },
  );
  if (JSON.stringify(element.semantic) === JSON.stringify(semantic))
    return false;
  editor.apply([{ type: "updateSemantic", id, semantic }]);
  return true;
}
