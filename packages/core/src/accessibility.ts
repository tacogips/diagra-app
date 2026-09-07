import type {
  AccessibilityMetadata,
  AccessibilityRole,
  ElementId,
} from "@diagra/ir";
import type { Editor } from "./editor.ts";

export interface AccessibilityPatch {
  readonly role?: AccessibilityRole | null;
  readonly label?: string | null;
  readonly hint?: string | null;
  readonly value?: string | null;
  readonly decorative?: boolean | null;
  readonly disabled?: boolean | null;
  readonly headingLevel?: number | null;
}

function compact(
  value: AccessibilityMetadata,
): AccessibilityMetadata | undefined {
  const next: AccessibilityMetadata = {
    ...(value.role ? { role: value.role } : {}),
    ...(value.label?.trim() ? { label: value.label.trim() } : {}),
    ...(value.hint?.trim() ? { hint: value.hint.trim() } : {}),
    ...(value.value?.trim() ? { value: value.value.trim() } : {}),
    ...(value.decorative ? { decorative: true } : {}),
    ...(value.disabled ? { disabled: true } : {}),
    ...(value.role === "heading" && value.headingLevel
      ? { headingLevel: value.headingLevel }
      : {}),
  };
  return Object.keys(next).length ? next : undefined;
}

/** Update portable accessibility metadata as one validated undo step. */
export function updateElementAccessibility(
  editor: Editor,
  id: ElementId,
  patch: AccessibilityPatch,
): void {
  const element = editor.store.get(id);
  if (!element) return;
  const merged = { ...element.accessibility } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      value === false
    )
      merged[key] = undefined;
    else merged[key] = value;
  }
  if (patch.role === "heading" && merged["headingLevel"] === undefined)
    merged["headingLevel"] = 2;
  if (patch.role !== undefined && patch.role !== "heading")
    merged["headingLevel"] = undefined;
  const accessibility = compact(merged as AccessibilityMetadata);
  if (JSON.stringify(accessibility) === JSON.stringify(element.accessibility))
    return;
  editor.apply([
    {
      type: "replaceAccessibility",
      id,
      ...(accessibility ? { accessibility } : {}),
    },
  ]);
}
