import {
  checkArray,
  checkBoolean,
  checkEnum,
  checkObject,
  checkNumber,
  checkString,
} from "./checks.ts";
import type { ElementTypeDefinition } from "./registry.ts";
import type { ValidationIssue } from "./issues.ts";
export const UI_CONTROL_KINDS = [
  "button",
  "input",
  "textarea",
  "select",
  "checkbox",
  "switch",
  "radio",
  "tabs",
  "progress",
] as const;
export type UiControlKind = (typeof UI_CONTROL_KINDS)[number];
export interface UiControlSemantic {
  readonly control: UiControlKind;
  /** Determinate progress, from 0 through 100. */
  readonly progress?: number;
  readonly label: string;
  readonly inputType?:
    | "text"
    | "email"
    | "password"
    | "number"
    | "search"
    | "tel"
    | "url"
    | "date";
  readonly value?: string;
  readonly placeholder?: string;
  readonly options?: readonly string[];
  readonly checked?: boolean;
  readonly disabled?: boolean;
}
export const uiControlDefinition: ElementTypeDefinition = {
  type: "ui.control",
  category: "node",
  onReferenceDeleted: "detach",
  references: () => [],
  keyOrder: {
    keys: [
      "control",
      "progress",
      "label",
      "inputType",
      "value",
      "placeholder",
      "options",
      "checked",
      "disabled",
    ],
  },
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (!checkObject(out, semantic, path)) return out;
    checkEnum(out, semantic.control, `${path}.control`, UI_CONTROL_KINDS);
    checkNumber(out, semantic.progress, `${path}.progress`, {
      optional: true,
      min: 0,
    });
    if (typeof semantic.progress === "number" && semantic.progress > 100)
      out.push({
        severity: "error",
        code: "value.max",
        path: `${path}.progress`,
        message: "Progress must be at most 100.",
      });
    if (semantic.inputType !== undefined)
      checkEnum(out, semantic.inputType, `${path}.inputType`, [
        "text",
        "email",
        "password",
        "number",
        "search",
        "tel",
        "url",
        "date",
      ]);
    checkString(out, semantic.label, `${path}.label`, { allowEmpty: true });
    for (const key of ["value", "placeholder"] as const)
      checkString(out, semantic[key], `${path}.${key}`, {
        optional: true,
        allowEmpty: true,
      });
    for (const key of ["checked", "disabled"] as const)
      checkBoolean(out, semantic[key], `${path}.${key}`, { optional: true });
    if (
      semantic.options !== undefined &&
      checkArray(out, semantic.options, `${path}.options`)
    )
      semantic.options.forEach((option, index) =>
        checkString(out, option, `${path}.options[${index}]`, {
          allowEmpty: true,
        }),
      );
    return out;
  },
};
