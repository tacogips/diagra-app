import type { ColorTokenSemantic } from "@diagra/ir";
import { Editor } from "./editor.ts";
import { applyCommands, type Command } from "./commands.ts";
import { leafElements } from "./group.ts";
import type { Store } from "./store.ts";
import type { ShapeUtilRegistry } from "./shape-util.ts";
import {
  activeTokenAlias,
  pageTokenMode,
  resolveColorToken,
} from "./token-values.ts";

export const COLOR_FIELDS = ["fill", "stroke", "color"] as const;
export type ColorField = (typeof COLOR_FIELDS)[number];

/** Selection inspection includes locked leaves, matching the fields shown to users. */
export function selectionColorBindings(editor: Editor) {
  const leaves = leafElements(editor.store, editor.selection.ids()).filter(
    (element) => element.type !== "design.token",
  );
  const context = editor.createShapeContext();
  const editable = leaves.filter(
    (element) => !context.isLocked?.(element.id),
  ).length;
  return COLOR_FIELDS.map((field) => {
    const links = leaves.map(
      (element) => element.visual.colorTokens?.[field] ?? null,
    );
    const tokenId = links[0] ?? null;
    const mixed = links.some((link) => link !== tokenId);
    const token = tokenId ? editor.store.get(tokenId) : undefined;
    const semantic =
      token?.type === "design.token" &&
      (token.semantic as { kind?: unknown }).kind === "color"
        ? (token.semantic as ColorTokenSemantic)
        : null;
    const resolved =
      tokenId && leaves[0]
        ? resolveColorToken(editor.store, tokenId, leaves[0].page)
        : null;
    return {
      field,
      count: leaves.length,
      editable,
      mixed,
      tokenId: mixed ? null : tokenId,
      name: mixed ? null : (semantic?.name ?? null),
      value: mixed ? null : (resolved?.value ?? semantic?.value ?? null),
      missing: !mixed && tokenId !== null && semantic === null,
      deferred: leaves.filter((element) => {
        const id = element.visual.colorTokens?.[field];
        const resource = id ? editor.store.get(id) : undefined;
        return (
          id &&
          (resource?.type !== "design.token" ||
            (resource.semantic as { kind?: unknown }).kind !== "color" ||
            element.visual.style?.[field] !==
              resolveColorToken(editor.store, id, element.page)?.value)
        );
      }).length,
    };
  });
}

/** Bind or detach one color field on the selection; detaching keeps its appearance. */
export function bindSelectionColor(
  editor: Editor,
  field: ColorField,
  tokenId: string | null,
): boolean {
  const token = tokenId ? editor.store.get(tokenId) : null;
  if (
    tokenId &&
    (token?.type !== "design.token" ||
      (token.semantic as { kind?: unknown }).kind !== "color")
  )
    return false;
  const commands: Command[] = [];
  for (const leaf of leafElements(editor.store, editor.selection.ids())) {
    if (
      leaf.type === "design.token" ||
      editor.createShapeContext().isLocked?.(leaf.id)
    )
      continue;
    const { colorTokens: old, ...rest } = leaf.visual;
    const links = { ...old };
    if (tokenId) links[field] = tokenId;
    else delete links[field];
    let solidStyle = { ...(rest.style ?? {}) };
    if (field === "fill") {
      const { fillGradient: _gradient, ...withoutGradient } = solidStyle;
      solidStyle = withoutGradient;
    } else if (field === "stroke") {
      const { strokeGradient: _gradient, ...withoutGradient } = solidStyle;
      solidStyle = withoutGradient;
    }
    const linkedValue = tokenId
      ? resolveColorToken(editor.store, tokenId, leaf.page)?.value
      : undefined;
    const linkedStyle = linkedValue
      ? {
          ...solidStyle,
          [field]: linkedValue,
        }
      : undefined;
    const visual = {
      ...rest,
      ...(Object.keys(links).length ? { colorTokens: links } : {}),
      ...(linkedStyle ? { style: linkedStyle } : {}),
    };
    if (JSON.stringify(visual) !== JSON.stringify(leaf.visual))
      commands.push({ type: "replaceVisual", id: leaf.id, visual });
  }
  if (!commands.length) return false;
  editor.apply(commands);
  return true;
}

/** Materialize linked values in the same transaction as resource edits. */
export function planColorTokens(
  store: Store,
  registry: ShapeUtilRegistry,
): Command[] {
  const commands: Command[] = [];
  if (
    !store.getSnapshot().elements.some((element) => element.visual.colorTokens)
  )
    return commands;
  const context = new Editor({
    document: store.getSnapshot(),
    registry,
  }).createShapeContext();
  const resolvedValues = new Map<string, Map<string, string | undefined>>();
  const valueFor = (id: string, page: string): string | undefined => {
    let pageValues = resolvedValues.get(page);
    if (!pageValues) {
      pageValues = new Map();
      resolvedValues.set(page, pageValues);
    }
    if (!pageValues.has(id))
      pageValues.set(id, resolveColorToken(store, id, page)?.value);
    return pageValues.get(id);
  };
  for (const element of store.getSnapshot().elements) {
    if (!element.visual.colorTokens || context.isLocked?.(element.id)) continue;
    const { colorTokens: old, ...rest } = element.visual;
    const links = { ...old };
    let style = { ...rest.style };
    for (const field of COLOR_FIELDS) {
      const id = links[field];
      if (!id) continue;
      const token = store.get(id);
      if (
        token?.type === "design.token" &&
        (token.semantic as { kind?: unknown }).kind === "color"
      ) {
        const value = valueFor(id, element.page);
        if (value === undefined) {
          delete links[field];
          continue;
        }
        if (field === "fill") {
          const { fillGradient: _gradient, ...solidStyle } = style;
          style = { ...solidStyle, fill: value };
        } else if (field === "stroke") {
          const { strokeGradient: _gradient, ...solidStyle } = style;
          style = { ...solidStyle, stroke: value };
        } else style[field] = value;
      } else delete links[field];
    }
    const visual = {
      ...rest,
      ...(Object.keys(style).length ? { style } : {}),
      ...(Object.keys(links).length ? { colorTokens: links } : {}),
    };
    if (JSON.stringify(visual) !== JSON.stringify(element.visual))
      commands.push({ type: "replaceVisual", id: element.id, visual });
  }
  if (commands.length) applyCommands(store, commands);
  return commands;
}

/** Resources are document-wide, even though each has a page owner for persistence. */
export function colorTokens(editor: Editor) {
  return editor
    .getSnapshot()
    .elements.filter(
      (element) =>
        element.type === "design.token" &&
        (element.semantic as { kind?: unknown }).kind === "color",
    )
    .map((element) => {
      const semantic = element.semantic as ColorTokenSemantic;
      const resolved = resolveColorToken(
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

export function createColorToken(
  editor: Editor,
  name: string,
  value: string,
): string | null {
  if (!name.trim() || !/^#[\da-f]{6}$/i.test(value)) return null;
  const element = editor.buildElement("design.token", {
    semantic: { name: name.trim(), kind: "color", value: value.toLowerCase() },
  });
  editor.apply([{ type: "createElement", element }]);
  return element.id;
}

export function updateColorToken(
  editor: Editor,
  id: string,
  name: string,
  value: string,
): boolean {
  const element = editor.store.get(id);
  if (
    !element ||
    element.type !== "design.token" ||
    (element.semantic as { kind?: unknown }).kind !== "color" ||
    editor.createShapeContext().isLocked?.(id) ||
    !name.trim() ||
    !/^#[\da-f]{6}$/i.test(value)
  )
    return false;
  const semantic: ColorTokenSemantic = {
    ...(element.semantic as ColorTokenSemantic),
    name: name.trim(),
    kind: "color",
  };
  const normalized = value.toLowerCase();
  const current = resolveColorToken(editor.store, id, editor.currentPageId);
  const next =
    current?.value === normalized
      ? semantic
      : withColorTokenChoice(
          semantic,
          pageTokenMode(editor.store, editor.currentPageId),
          { value: normalized },
        );
  if (JSON.stringify(element.semantic) !== JSON.stringify(next))
    editor.apply([{ type: "updateSemantic", id, semantic: next }]);
  return true;
}

function withColorTokenChoice(
  semantic: ColorTokenSemantic,
  mode: string | undefined,
  choice: { readonly value: string } | { readonly alias: string },
): ColorTokenSemantic {
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
export function setColorTokenAlias(
  editor: Editor,
  id: string,
  targetId: string | null,
): boolean {
  const element = editor.store.get(id);
  if (
    !element ||
    element.type !== "design.token" ||
    (element.semantic as { kind?: unknown }).kind !== "color" ||
    editor.createShapeContext().isLocked?.(id)
  )
    return false;
  const current = resolveColorToken(editor.store, id, editor.currentPageId);
  if (!current) return false;
  if (targetId) {
    const target = resolveColorToken(
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
  const semantic = withColorTokenChoice(
    element.semantic as ColorTokenSemantic,
    pageTokenMode(editor.store, editor.currentPageId),
    targetId ? { alias: targetId } : { value: current.value },
  );
  if (JSON.stringify(element.semantic) === JSON.stringify(semantic))
    return false;
  editor.apply([{ type: "updateSemantic", id, semantic }]);
  return true;
}
