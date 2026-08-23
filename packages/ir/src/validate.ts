// Document-level validation.
//
// Severity contract: `error` means the document is structurally unusable and
// readers must refuse it. `warning` means the document is usable but this
// build cannot fully interpret it (unknown element type) or it is internally
// incomplete (dangling reference). Forward compatibility depends on unknown
// element types staying warnings, so a newer file still round-trips here.
//
// Everything below treats its input as untrusted: a document reaching this
// function may have come straight off disk, so fields are read as `unknown`
// rather than trusted from the declared types.

import { checkEnum, checkNumber, checkObject, checkString } from "./checks.ts";
import {
  DocumentValidationError,
  error,
  hasErrors,
  type ValidationIssue,
  warning,
} from "./issues.ts";
import { VISUAL_KEY_ORDER, VISUAL_STYLE_KEY_ORDER } from "./keyOrder.ts";
import { getElementTypeDefinition } from "./registry.ts";
import { type Document, isPlainObject, PAGE_KINDS } from "./types.ts";

const VISUAL_NUMBER_FIELDS = ["x", "y", "width", "height", "rotation"] as const;

const STYLE_NUMBER_FIELDS = ["strokeWidth", "opacity", "fontSize"] as const;

const NON_NEGATIVE_VISUAL_FIELDS = ["width", "height"] as const;

const DASH_VALUES = ["solid", "dashed", "dotted"] as const;
const TEXT_ALIGN_VALUES = ["start", "middle", "end"] as const;

function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readField(value: unknown, field: string): unknown {
  return isPlainObject(value) ? value[field] : undefined;
}

/**
 * Warn about every key this build does not model. `visual` and
 * `visual.style` are treated identically: both are closed sets of modelled
 * keys plus an `extensions` bag.
 *
 * Reachability, so nobody reads more into these warnings than is there:
 * they fire for documents built in memory, not for documents that came from
 * `parseDocument`. The JSONL reader relocates every unmodelled key into the
 * `extensions` bag before validation runs, so a parsed document has no
 * inline unknown keys left to warn about. Whether a populated `extensions`
 * bag should itself warn - here and at the document, page and element levels
 * that never warn at all - is an open diagnostics question, not something
 * this function decides.
 */
function warnUnknownFields(
  out: ValidationIssue[],
  raw: Record<string, unknown>,
  known: readonly string[],
  path: string,
  label: string,
): void {
  for (const field of Object.keys(raw)) {
    if (field !== "extensions" && !known.includes(field)) {
      out.push(
        warning(
          "field.unknown",
          `${path}.${field}`,
          `unknown ${label} field; preserved but ignored by this build`,
        ),
      );
    }
  }
}

function validateVisual(
  out: ValidationIssue[],
  raw: unknown,
  path: string,
): void {
  if (raw === undefined) {
    return;
  }
  if (!checkObject(out, raw, path)) {
    return;
  }
  for (const field of VISUAL_NUMBER_FIELDS) {
    checkNumber(out, raw[field], `${path}.${field}`, { optional: true });
  }
  for (const field of NON_NEGATIVE_VISUAL_FIELDS) {
    const value = raw[field];
    if (typeof value === "number" && value < 0) {
      out.push(error("value.min", `${path}.${field}`, "must not be negative"));
    }
  }
  warnUnknownFields(out, raw, VISUAL_KEY_ORDER.keys, path, "visual");

  const style = raw["style"];
  if (style === undefined) {
    return;
  }
  if (!checkObject(out, style, `${path}.style`)) {
    return;
  }
  for (const field of STYLE_NUMBER_FIELDS) {
    checkNumber(out, style[field], `${path}.style.${field}`, {
      optional: true,
    });
  }
  checkEnum(out, style["dash"], `${path}.style.dash`, DASH_VALUES, {
    optional: true,
  });
  checkEnum(
    out,
    style["textAlign"],
    `${path}.style.textAlign`,
    TEXT_ALIGN_VALUES,
    { optional: true },
  );
  warnUnknownFields(
    out,
    style,
    VISUAL_STYLE_KEY_ORDER.keys,
    `${path}.style`,
    "style",
  );
}

function validateElement(
  out: ValidationIssue[],
  raw: unknown,
  path: string,
  pageIds: ReadonlySet<string>,
): void {
  if (!checkObject(out, raw, path)) {
    return;
  }
  checkString(out, raw["id"], `${path}.id`);
  checkString(out, raw["index"], `${path}.index`);

  const page = raw["page"];
  if (checkString(out, page, `${path}.page`) && typeof page === "string") {
    if (!pageIds.has(page)) {
      out.push(
        error(
          "reference.missingPage",
          `${path}.page`,
          `element references unknown page "${page}"`,
        ),
      );
    }
  }

  const type = raw["type"];
  if (!checkString(out, type, `${path}.type`) || typeof type !== "string") {
    return;
  }

  // Every element carries an object payload, whether or not this build knows
  // the type — `Element<S>.semantic` is a record, never a scalar. Checking it
  // here rather than only inside each registry entry closes the gap for
  // unregistered types, where nothing else would look at it.
  const semantic = raw["semantic"];
  const semanticIsObject = checkObject(out, semantic, `${path}.semantic`);

  const definition = getElementTypeDefinition(type);
  if (definition) {
    if (semanticIsObject) {
      out.push(...definition.validateSemantic(semantic, `${path}.semantic`));
    }
  } else {
    out.push(
      warning(
        "type.unknown",
        `${path}.type`,
        `unknown element type "${type}"; semantic payload preserved but not validated`,
      ),
    );
  }

  validateVisual(out, raw["visual"], `${path}.visual`);
}

export interface ValidateOptions {
  /**
   * Report references to element ids that are absent from the document.
   * Enabled by default; turn it off when validating a partial fragment.
   */
  readonly checkReferences?: boolean;
}

/**
 * Validate a document and return every issue found. Never throws: callers
 * decide how to treat warnings.
 */
export function validateDocument(
  document: Document,
  options: ValidateOptions = {},
): readonly ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const root: unknown = document;
  if (!isPlainObject(root)) {
    return [error("type.object", "", "expected a document object")];
  }

  checkNumber(out, root["schemaVersion"], "schemaVersion", {
    integer: true,
    min: 1,
  });
  checkString(out, root["id"], "id");
  checkString(out, root["title"], "title", { allowEmpty: true });

  const pageIds = new Set<string>();
  const pages = asArray(root["pages"]);
  if (pages) {
    for (const [i, page] of pages.entries()) {
      const path = `pages[${i}]`;
      if (!checkObject(out, page, path)) {
        continue;
      }
      const id = page["id"];
      if (checkString(out, id, `${path}.id`) && typeof id === "string") {
        if (pageIds.has(id)) {
          out.push(
            error("id.duplicate", `${path}.id`, `duplicate page id "${id}"`),
          );
        }
        pageIds.add(id);
      }
      checkString(out, page["name"], `${path}.name`, { allowEmpty: true });
      checkEnum(out, page["kind"], `${path}.kind`, PAGE_KINDS);
    }
  } else {
    out.push(error("type.array", "pages", "expected an array"));
  }

  const elements = asArray(root["elements"]);
  if (!elements) {
    out.push(error("type.array", "elements", "expected an array"));
    return out;
  }

  const elementIds = new Set<string>();
  for (const [i, element] of elements.entries()) {
    const path = `elements[${i}]`;
    validateElement(out, element, path, pageIds);
    const id = readField(element, "id");
    if (typeof id === "string") {
      if (elementIds.has(id)) {
        out.push(
          error("id.duplicate", `${path}.id`, `duplicate element id "${id}"`),
        );
      }
      elementIds.add(id);
    }
  }

  if (options.checkReferences !== false) {
    for (const [i, element] of elements.entries()) {
      const type = readField(element, "type");
      if (typeof type !== "string") {
        continue;
      }
      const definition = getElementTypeDefinition(type);
      if (!definition) {
        continue;
      }
      for (const reference of definition.references(
        readField(element, "semantic"),
      )) {
        if (!elementIds.has(reference.id)) {
          out.push(
            warning(
              "reference.dangling",
              `elements[${i}].semantic.${reference.field}`,
              `references unknown element "${reference.id}"`,
            ),
          );
        }
      }
    }
  }

  return out;
}

/** Throw {@link DocumentValidationError} when validation produced errors. */
export function assertValidDocument(
  document: Document,
  options: ValidateOptions = {},
): readonly ValidationIssue[] {
  const issues = validateDocument(document, options);
  if (hasErrors(issues)) {
    throw new DocumentValidationError(issues, "invalid document");
  }
  return issues;
}

export function isValidDocument(
  document: Document,
  options: ValidateOptions = {},
): boolean {
  return !hasErrors(validateDocument(document, options));
}
