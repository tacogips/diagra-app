import type {
  ComponentVariantProperty,
  ElementId,
  FrameSemantic,
} from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { newElementId } from "./ids.ts";

export const MAX_VARIANT_PROPERTIES = 16;

function keyOf(name: string): string {
  return name.trim().toLowerCase();
}

function propertiesOf(
  semantic: FrameSemantic,
): readonly ComponentVariantProperty[] {
  return Array.isArray(semantic.variantProperties)
    ? semantic.variantProperties
    : [];
}

function propertyMap(semantic: FrameSemantic): ReadonlyMap<string, string> {
  return new Map(
    propertiesOf(semantic).map((property) => [
      keyOf(property.name),
      property.value.trim(),
    ]),
  );
}

function sameSelection(
  candidate: ReadonlyMap<string, string>,
  selection: ReadonlyMap<string, string>,
): boolean {
  return (
    candidate.size === selection.size &&
    [...selection].every(([name, value]) => candidate.get(name) === value)
  );
}

/** Resolve a definition's named family across document pages. */
export function componentVariants(editor: Editor, sourceId: ElementId) {
  const source = editor.store.get(sourceId);
  if (!source || source.type !== "frame") return [];
  const semantic = source.semantic as FrameSemantic;
  if (!semantic.component || !semantic.variantSet) return [];
  return editor
    .getSnapshot()
    .elements.filter((element) => {
      if (element.type !== "frame") return false;
      const candidate = element.semantic as FrameSemantic;
      return (
        candidate.component && candidate.variantSet === semantic.variantSet
      );
    })
    .map((element) => ({
      id: element.id,
      label: (() => {
        const candidate = element.semantic as FrameSemantic;
        const properties = propertiesOf(candidate);
        return properties.length
          ? properties
              .map(
                (property) =>
                  `${property.name.trim()}=${property.value.trim()}`,
              )
              .join(", ")
          : candidate.variantName || candidate.name || "Unnamed variant";
      })(),
      page: editor.store.getPage(element.page)?.name ?? "",
      properties: propertiesOf(element.semantic as FrameSemantic),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export interface ComponentVariantAxis {
  readonly name: string;
  readonly value: string;
  /** Only values with an existing combination for the other current axes. */
  readonly values: readonly string[];
}

/** Property controls available for one definition or instance's source. */
export function componentVariantAxes(
  editor: Editor,
  sourceId: ElementId,
): readonly ComponentVariantAxis[] {
  const source = editor.store.get(sourceId);
  if (!source || source.type !== "frame") return [];
  const semantic = source.semantic as FrameSemantic;
  const current = propertyMap(semantic);
  if (!current.size) return [];
  const variants = componentVariants(editor, sourceId);
  const displayNames = new Map(
    propertiesOf(semantic).map((property) => [
      keyOf(property.name),
      property.name.trim(),
    ]),
  );
  return [...current].map(([axis, value]) => {
    const values = new Set<string>();
    for (const variant of variants) {
      const candidate = propertyMap(
        editor.store.get(variant.id)?.semantic as FrameSemantic,
      );
      const compatible = [...current].every(
        ([name, selected]) => name === axis || candidate.get(name) === selected,
      );
      const option = candidate.get(axis);
      if (compatible && option !== undefined) values.add(option);
    }
    return {
      name: displayNames.get(axis) ?? axis,
      value,
      values: [...values].sort((a, b) => a.localeCompare(b)),
    };
  });
}

function validProperties(properties: readonly ComponentVariantProperty[]) {
  if (properties.length > MAX_VARIANT_PROPERTIES) return false;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const property of properties) {
    const name = keyOf(property.name);
    if (
      !property.id ||
      ids.has(property.id) ||
      !name ||
      names.has(name) ||
      !property.value.trim()
    )
      return false;
    ids.add(property.id);
    names.add(name);
  }
  return true;
}

function writeProperties(
  editor: Editor,
  id: ElementId,
  semantic: FrameSemantic,
  properties: readonly ComponentVariantProperty[],
): boolean {
  if (!validProperties(properties)) return false;
  const { variantProperties: _old, ...rest } = semantic;
  const next: FrameSemantic = {
    ...rest,
    ...(properties.length ? { variantProperties: properties } : {}),
  };
  if (JSON.stringify(next) === JSON.stringify(semantic)) return false;
  editor.apply([{ type: "updateSemantic", id, semantic: next }]);
  return true;
}

export function addComponentVariantProperty(
  editor: Editor,
  definitionId: ElementId,
  name: string,
  value: string,
  id: string = newElementId(),
): boolean {
  const element = editor.store.get(definitionId);
  if (
    element?.type !== "frame" ||
    !(element.semantic as FrameSemantic).component ||
    editor.createShapeContext().isLocked?.(definitionId)
  )
    return false;
  const semantic = element.semantic as FrameSemantic;
  return writeProperties(editor, definitionId, semantic, [
    ...propertiesOf(semantic),
    { id, name: name.trim(), value: value.trim() },
  ]);
}

export function updateComponentVariantProperty(
  editor: Editor,
  definitionId: ElementId,
  propertyId: string,
  name: string,
  value: string,
): boolean {
  const element = editor.store.get(definitionId);
  if (
    element?.type !== "frame" ||
    !(element.semantic as FrameSemantic).component ||
    editor.createShapeContext().isLocked?.(definitionId)
  )
    return false;
  const semantic = element.semantic as FrameSemantic;
  const properties = propertiesOf(semantic);
  if (!properties.some((property) => property.id === propertyId)) return false;
  return writeProperties(
    editor,
    definitionId,
    semantic,
    properties.map((property) =>
      property.id === propertyId
        ? { ...property, name: name.trim(), value: value.trim() }
        : property,
    ),
  );
}

export function removeComponentVariantProperty(
  editor: Editor,
  definitionId: ElementId,
  propertyId: string,
): boolean {
  const element = editor.store.get(definitionId);
  if (
    element?.type !== "frame" ||
    !(element.semantic as FrameSemantic).component ||
    editor.createShapeContext().isLocked?.(definitionId)
  )
    return false;
  const semantic = element.semantic as FrameSemantic;
  const properties = propertiesOf(semantic);
  if (!properties.some((property) => property.id === propertyId)) return false;
  return writeProperties(
    editor,
    definitionId,
    semantic,
    properties.filter((property) => property.id !== propertyId),
  );
}

/** Switch one axis while retaining the instance's current values on all others. */
export function switchComponentVariantProperty(
  editor: Editor,
  instanceId: ElementId,
  name: string,
  value: string,
): boolean {
  const instance = editor.store.get(instanceId);
  const sourceId =
    instance?.type === "frame"
      ? (instance.semantic as FrameSemantic).instanceOf
      : undefined;
  const source = sourceId ? editor.store.get(sourceId) : undefined;
  if (!sourceId || source?.type !== "frame") return false;
  const selection = new Map(propertyMap(source.semantic as FrameSemantic));
  const key = keyOf(name);
  const selectedValue = value.trim();
  if (!selection.has(key) || !selectedValue) return false;
  selection.set(key, selectedValue);
  const matches = componentVariants(editor, sourceId).filter((variant) => {
    const candidate = editor.store.get(variant.id);
    return (
      candidate?.type === "frame" &&
      sameSelection(propertyMap(candidate.semantic as FrameSemantic), selection)
    );
  });
  return matches.length === 1
    ? editor.switchComponentVariant(instanceId, matches[0]?.id ?? "")
    : false;
}
