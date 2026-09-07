import type {
  AccessibilityRole,
  Element,
  ElementId,
  FrameSemantic,
  GenericEdgeSemantic,
  ImageSemantic,
} from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { collectInterfaceTree } from "./interface-tree.ts";

export type AccessibilityAuditSeverity = "error" | "warning";

export interface AccessibilityAuditIssue {
  readonly severity: AccessibilityAuditSeverity;
  readonly code: string;
  readonly elementId: ElementId;
  readonly message: string;
}

export interface AccessibilityAuditReport {
  readonly rootId: ElementId;
  readonly auditedElements: number;
  readonly errors: number;
  readonly warnings: number;
  readonly passed: boolean;
  readonly issues: readonly AccessibilityAuditIssue[];
}

const INTERACTIVE_ROLES = new Set<AccessibilityRole>([
  "button",
  "link",
  "textbox",
  "checkbox",
  "switch",
]);

function accessibleName(editor: Editor, element: Element): string {
  if (element.accessibility?.label?.trim())
    return element.accessibility.label.trim();
  const text = editor.getText(element.id)?.trim();
  if (text) return text;
  if (element.type === "image.raster")
    return (element.semantic as ImageSemantic).alt.trim();
  if (element.type === "frame")
    return (element.semantic as FrameSemantic).name.trim();
  return "";
}

function opaqueRgb(value: string | undefined): readonly number[] | null {
  if (!value) return null;
  const match = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (!match) return null;
  const hex = match[1] as string;
  if (hex.length === 8 && hex.slice(6).toLowerCase() !== "ff") return null;
  const six =
    hex.length === 3
      ? [...hex].map((character) => character.repeat(2)).join("")
      : hex.slice(0, 6);
  return [0, 2, 4].map((offset) =>
    Number.parseInt(six.slice(offset, offset + 2), 16),
  );
}

function luminance(rgb: readonly number[]): number {
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}

export function colorContrastRatio(
  foreground: string,
  background: string,
): number | null {
  const front = opaqueRgb(foreground);
  const back = opaqueRgb(background);
  if (!front || !back) return null;
  const light = Math.max(luminance(front), luminance(back));
  const dark = Math.min(luminance(front), luminance(back));
  return (light + 0.05) / (dark + 0.05);
}

/** Deterministic, read-only audit for one layer or a visible artboard tree. */
export function auditAccessibility(
  editor: Editor,
  rootId: ElementId,
): AccessibilityAuditReport | null {
  const root = editor.store.get(rootId);
  if (!root) return null;
  const tree = collectInterfaceTree(editor, rootId);
  const elements = tree?.included ?? [root];
  const includedIds = new Set(elements.map((element) => element.id));
  const parents = tree?.parents ?? new Map<ElementId, ElementId>();
  const issues: AccessibilityAuditIssue[] = [];
  const add = (
    severity: AccessibilityAuditSeverity,
    code: string,
    element: Element,
    message: string,
  ): void => {
    issues.push({ severity, code, elementId: element.id, message });
  };

  const prototypeSources = new Set<ElementId>();
  for (const element of editor.store.getPageElements(root.page)) {
    if (element.type !== "edge.generic") continue;
    const semantic = element.semantic as GenericEdgeSemantic;
    if (semantic.prototype && includedIds.has(semantic.from))
      prototypeSources.add(semantic.from);
  }

  const backgroundOf = (element: Element): string | null => {
    let current: Element | undefined = element;
    const seen = new Set<ElementId>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.visual.style?.fillGradient) return null;
      const fill = current.visual.style?.fill;
      if (fill && opaqueRgb(fill)) return fill;
      const parentId = parents.get(current.id);
      current = parentId ? editor.store.get(parentId) : undefined;
    }
    return null;
  };

  const platform =
    root.type === "frame"
      ? (root.semantic as FrameSemantic).platform
      : undefined;
  const minimumTarget =
    platform === "android" ? 48 : platform === "ios" ? 44 : 24;
  let previousHeadingLevel = 0;
  const mainLandmarks: Element[] = [];
  const navigationLandmarks: Element[] = [];

  for (const element of elements) {
    const metadata = element.accessibility;
    const role = metadata?.role;
    if (metadata?.decorative) {
      const conflicts = [
        metadata.role,
        metadata.label,
        metadata.hint,
        metadata.value,
        metadata.disabled,
        metadata.headingLevel,
      ].some((value) => value !== undefined);
      if (conflicts)
        add(
          "warning",
          "decorative.conflict",
          element,
          "Decorative content ignores its other accessibility fields.",
        );
      if (prototypeSources.has(element.id))
        add(
          "error",
          "decorative.interactive",
          element,
          "A prototype hotspot cannot be decorative.",
        );
      continue;
    }

    const name = accessibleName(editor, element);
    if ((role && INTERACTIVE_ROLES.has(role)) || role === "region") {
      if (!name)
        add(
          "error",
          "name.missing",
          element,
          `The ${role} role needs an accessible name.`,
        );
    }
    if (
      element.type === "image.raster" &&
      !(element.semantic as ImageSemantic).alt.trim() &&
      !metadata?.label
    )
      add(
        "error",
        "image.nameMissing",
        element,
        "Add image alt text or mark the image decorative.",
      );
    if (prototypeSources.has(element.id) && !role)
      add(
        "warning",
        "interactive.roleMissing",
        element,
        "This prototype hotspot has no authored interactive role for handoff.",
      );
    if (metadata?.disabled && (!role || !INTERACTIVE_ROLES.has(role)))
      add(
        "warning",
        "disabled.roleMismatch",
        element,
        "Disabled state should be paired with an interactive role.",
      );

    if (role === "heading") {
      const level = metadata?.headingLevel;
      if (!level)
        add(
          "error",
          "heading.levelMissing",
          element,
          "Heading role requires a level from 1 through 6.",
        );
      else {
        if (previousHeadingLevel && level > previousHeadingLevel + 1)
          add(
            "warning",
            "heading.levelSkipped",
            element,
            `Heading order jumps from level ${previousHeadingLevel} to ${level}.`,
          );
        previousHeadingLevel = level;
      }
    }
    if (role === "main") mainLandmarks.push(element);
    if (role === "navigation") navigationLandmarks.push(element);

    if (
      (role && INTERACTIVE_ROLES.has(role)) ||
      prototypeSources.has(element.id)
    ) {
      const bounds = editor.getBounds(element.id);
      if (
        bounds &&
        (bounds.width < minimumTarget || bounds.height < minimumTarget)
      )
        add(
          "warning",
          "target.tooSmall",
          element,
          `Interactive target is ${Number(bounds.width.toFixed(2))} x ${Number(bounds.height.toFixed(2))}; use at least ${minimumTarget} x ${minimumTarget} for this artboard.`,
        );
    }

    const text = editor.getText(element.id)?.trim();
    const foreground = element.visual.style?.color;
    const background = text && foreground ? backgroundOf(element) : null;
    const ratio =
      foreground && background
        ? colorContrastRatio(foreground, background)
        : null;
    if (ratio !== null) {
      const fontSize = element.visual.style?.fontSize ?? 16;
      const fontWeight = element.visual.style?.fontWeight ?? 400;
      const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const required = large ? 3 : 4.5;
      if (ratio < required)
        add(
          "warning",
          "contrast.low",
          element,
          `Text contrast is ${ratio.toFixed(2)}:1; this size and weight need at least ${required}:1.`,
        );
    }
  }

  for (const element of mainLandmarks.slice(1))
    add(
      "error",
      "landmark.mainDuplicate",
      element,
      "An artboard should not contain more than one main landmark.",
    );
  if (navigationLandmarks.length > 1) {
    for (const element of navigationLandmarks) {
      if (!element.accessibility?.label)
        add(
          "warning",
          "landmark.navigationNameMissing",
          element,
          "Multiple navigation landmarks need distinct explicit labels.",
        );
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  return {
    rootId,
    auditedElements: elements.length,
    errors,
    warnings,
    passed: errors === 0 && warnings === 0,
    issues,
  };
}
