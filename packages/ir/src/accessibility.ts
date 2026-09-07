import {
  checkBoolean,
  checkEnum,
  checkNumber,
  checkObject,
  checkString,
} from "./checks.ts";
import { error, type ValidationIssue } from "./issues.ts";

export const ACCESSIBILITY_ROLES = [
  "button",
  "link",
  "image",
  "heading",
  "text",
  "textbox",
  "checkbox",
  "switch",
  "navigation",
  "main",
  "region",
  "group",
  "list",
  "list-item",
] as const;

export type AccessibilityRole = (typeof ACCESSIBILITY_ROLES)[number];

/** Portable implementation semantics authored independently of visible text. */
export interface AccessibilityMetadata {
  readonly role?: AccessibilityRole;
  readonly label?: string;
  readonly hint?: string;
  readonly value?: string;
  readonly decorative?: boolean;
  readonly disabled?: boolean;
  readonly headingLevel?: number;
}

export const ACCESSIBILITY_KEY_ORDER = {
  keys: [
    "role",
    "label",
    "hint",
    "value",
    "decorative",
    "disabled",
    "headingLevel",
  ],
} as const;

export function validateAccessibilityMetadata(
  value: unknown,
  path: string,
): readonly ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (value === undefined) return out;
  if (!checkObject(out, value, path)) return out;
  checkEnum(out, value["role"], `${path}.role`, ACCESSIBILITY_ROLES, {
    optional: true,
  });
  for (const field of ["label", "hint", "value"])
    checkString(out, value[field], `${path}.${field}`, { optional: true });
  for (const field of ["decorative", "disabled"])
    checkBoolean(out, value[field], `${path}.${field}`, { optional: true });
  checkNumber(out, value["headingLevel"], `${path}.headingLevel`, {
    optional: true,
    integer: true,
    min: 1,
  });
  if (typeof value["headingLevel"] === "number" && value["headingLevel"] > 6)
    out.push(
      error(
        "value.max",
        `${path}.headingLevel`,
        "heading level must not exceed 6",
      ),
    );
  if (value["headingLevel"] !== undefined && value["role"] !== "heading")
    out.push(
      error(
        "accessibility.headingRole",
        `${path}.headingLevel`,
        "heading level requires the heading role",
      ),
    );
  if (value["role"] === "heading" && value["headingLevel"] === undefined)
    out.push(
      error(
        "field.missing",
        `${path}.headingLevel`,
        "heading role requires a heading level",
      ),
    );
  return out;
}
