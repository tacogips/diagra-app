import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
  type GroupSemantic,
} from "@diagra/ir";
import { canProvideMask, isRasterMaskSource } from "./clipping.ts";
import type { Editor } from "./editor.ts";
import { memberIdsOf } from "./group.ts";
import { croppedImageBox } from "./image-crop.ts";

function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function number(value: number): string {
  return String(Number(value.toFixed(4)));
}

export function canBeMask(
  editor: Editor,
  element: Element | undefined,
): boolean {
  if (
    !element ||
    element.type === "group" ||
    getElementTypeDefinition(element.type)?.category === "edge" ||
    getElementTypeDefinition(element.type)?.category === "resource"
  )
    return false;
  return canProvideMask(element, editor.createShapeContext());
}

export function groupMaskCandidates(
  editor: Editor,
  groupId: ElementId,
): readonly Element[] {
  const group = editor.store.get(groupId);
  if (group?.type !== "group") return [];
  return memberIdsOf(group)
    .map((id) => editor.store.get(id))
    .filter((element): element is Element => canBeMask(editor, element));
}

export function setGroupMask(
  editor: Editor,
  groupId: ElementId,
  maskId: ElementId | null,
): boolean {
  const group = editor.store.get(groupId);
  if (
    group?.type !== "group" ||
    editor.createShapeContext().isLocked?.(groupId)
  )
    return false;
  const semantic = group.semantic as GroupSemantic;
  if (maskId) {
    const mask = editor.store.get(maskId);
    if (
      !memberIdsOf(group).includes(maskId) ||
      mask?.page !== group.page ||
      !canBeMask(editor, mask)
    )
      return false;
  }
  if ((semantic.maskId ?? null) === maskId) return false;
  const {
    maskId: _mask,
    maskMode: _maskMode,
    booleanOperation: _operation,
    ...rest
  } = semantic;
  editor.apply([
    {
      type: "updateSemantic",
      id: groupId,
      semantic: maskId
        ? {
            ...rest,
            maskId,
            ...(isRasterMaskSource(editor.store.get(maskId))
              ? { maskMode: semantic.maskMode ?? "alpha" }
              : {}),
          }
        : rest,
    },
  ]);
  return true;
}

export function setGroupRasterMaskMode(
  editor: Editor,
  groupId: ElementId,
  maskMode: "alpha" | "luminance",
): boolean {
  const group = editor.store.get(groupId);
  if (
    group?.type !== "group" ||
    editor.createShapeContext().isLocked?.(groupId)
  )
    return false;
  const semantic = group.semantic as GroupSemantic;
  if (
    !semantic.maskId ||
    !isRasterMaskSource(editor.store.get(semantic.maskId))
  )
    return false;
  if ((semantic.maskMode ?? "alpha") === maskMode) return false;
  editor.apply([
    {
      type: "updateSemantic",
      id: groupId,
      semantic: { ...semantic, maskMode },
    },
  ]);
  return true;
}

/** CSS SVG mask for a raster source, in its owning group's page coordinates. */
export function rasterGroupMaskCss(
  editor: Editor,
  groupId: ElementId,
): string | undefined {
  const group = editor.store.get(groupId);
  if (group?.type !== "group") return undefined;
  const semantic = group.semantic as GroupSemantic;
  const source = semantic.maskId
    ? editor.store.get(semantic.maskId)
    : undefined;
  if (!source || !isRasterMaskSource(source)) return undefined;
  const groupBox = editor.getBounds(groupId);
  const sourceBox = editor.getBounds(source.id);
  if (!groupBox || !sourceBox || groupBox.width <= 0 || groupBox.height <= 0)
    return undefined;
  const image = source.semantic as {
    src: string;
    crop?: { x: number; y: number; width: number; height: number };
  };
  const imageBox = image.crop
    ? croppedImageBox(image.crop, sourceBox)
    : sourceBox;
  const rotation = source.visual.rotation ?? 0;
  const transform = rotation
    ? ` transform="rotate(${number(rotation)} ${number(sourceBox.x + sourceBox.width / 2)} ${number(sourceBox.y + sourceBox.height / 2)})"`
    : "";
  const media = `<image x="${number(imageBox.x)}" y="${number(imageBox.y)}" width="${number(imageBox.width)}" height="${number(imageBox.height)}" href="${attribute(image.src)}" preserveAspectRatio="none"/>`;
  const clipped = image.crop
    ? `<svg x="${number(sourceBox.x)}" y="${number(sourceBox.y)}" width="${number(sourceBox.width)}" height="${number(sourceBox.height)}" overflow="hidden">${media}</svg>`
    : media;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${number(groupBox.x)} ${number(groupBox.y)} ${number(groupBox.width)} ${number(groupBox.height)}"><g${transform}>${clipped}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
