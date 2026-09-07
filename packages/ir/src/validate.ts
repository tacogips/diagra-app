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

import {
  checkBoolean,
  checkEnum,
  checkFontSettings,
  checkNumber,
  checkObject,
  checkString,
} from "./checks.ts";
import { validateAccessibilityMetadata } from "./accessibility.ts";
import {
  DocumentValidationError,
  error,
  hasErrors,
  type ValidationIssue,
  warning,
} from "./issues.ts";
import { VISUAL_KEY_ORDER, VISUAL_STYLE_KEY_ORDER } from "./keyOrder.ts";
import { getElementTypeDefinition } from "./registry.ts";
import {
  BLEND_MODES,
  type Document,
  isPlainObject,
  PAGE_KINDS,
} from "./types.ts";

const VISUAL_NUMBER_FIELDS = [
  "x",
  "y",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "aspectRatio",
  "rotation",
] as const;

const STYLE_NUMBER_FIELDS = [
  "strokeWidth",
  "strokeMiterLimit",
  "strokeDashOffset",
  "opacity",
  "fontSize",
] as const;

const NON_NEGATIVE_VISUAL_FIELDS = ["width", "height"] as const;

const SIZE_LIMIT_FIELDS = [
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
] as const;

const DASH_VALUES = ["solid", "dashed", "dotted"] as const;
const STROKE_CAP_VALUES = ["butt", "round", "square"] as const;
const STROKE_JOIN_VALUES = ["miter", "round", "bevel"] as const;
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

function validateGradient(
  out: ValidationIssue[],
  gradient: unknown,
  path: string,
): void {
  if (gradient === undefined || !checkObject(out, gradient, path)) return;
  checkEnum(out, gradient["type"], `${path}.type`, [
    "linear",
    "radial",
    "angular",
    "diamond",
  ]);
  if (
    gradient["type"] === "linear" ||
    gradient["type"] === "angular" ||
    gradient["type"] === "diamond"
  )
    checkNumber(out, gradient["angle"], `${path}.angle`);
  if (
    gradient["type"] === "radial" ||
    gradient["type"] === "angular" ||
    gradient["type"] === "diamond"
  ) {
    for (const field of ["centerX", "centerY"])
      checkNumber(out, gradient[field], `${path}.${field}`, { min: 0 });
    if (gradient["type"] !== "angular")
      checkNumber(out, gradient["radius"], `${path}.radius`, { min: 0.01 });
    for (const field of ["centerX", "centerY"])
      if (typeof gradient[field] === "number" && gradient[field] > 1)
        out.push(error("value.max", `${path}.${field}`, "must not exceed 1"));
    if (
      gradient["type"] !== "angular" &&
      typeof gradient["radius"] === "number" &&
      gradient["radius"] > 2
    )
      out.push(error("value.max", `${path}.radius`, "must not exceed 2"));
  }
  const stops = gradient["stops"];
  if (!Array.isArray(stops)) {
    out.push(error("type.array", `${path}.stops`, "expected an array"));
    return;
  }
  if (stops.length < 2 || stops.length > 8)
    out.push(error("gradient.stops", `${path}.stops`, "expected 2 to 8 stops"));
  let previous = -1;
  for (const [index, stop] of stops.entries()) {
    const stopPath = `${path}.stops[${index}]`;
    if (!checkObject(out, stop, stopPath)) continue;
    checkNumber(out, stop["offset"], `${stopPath}.offset`, { min: 0 });
    if (typeof stop["offset"] === "number") {
      if (stop["offset"] > 1)
        out.push(error("value.max", `${stopPath}.offset`, "must not exceed 1"));
      if (stop["offset"] < previous)
        out.push(
          error(
            "gradient.order",
            `${stopPath}.offset`,
            "must not precede the previous stop",
          ),
        );
      previous = stop["offset"];
    }
    if (
      typeof stop["color"] !== "string" ||
      !/^#[\da-f]{6}$/i.test(stop["color"])
    )
      out.push(
        error(
          "value.color",
          `${stopPath}.color`,
          "expected a six-digit hex color",
        ),
      );
    checkNumber(out, stop["opacity"], `${stopPath}.opacity`, {
      optional: true,
      min: 0,
    });
    if (typeof stop["opacity"] === "number" && stop["opacity"] > 1)
      out.push(error("value.max", `${stopPath}.opacity`, "must not exceed 1"));
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
  for (const field of ["hidden", "locked", "prototypeFixed"]) {
    checkBoolean(out, raw[field], `${path}.${field}`, { optional: true });
  }
  checkString(out, raw["componentKey"], `${path}.componentKey`, {
    optional: true,
  });
  checkEnum(
    out,
    raw["textResize"],
    `${path}.textResize`,
    ["fixed", "auto-width", "auto-height"],
    { optional: true },
  );
  const colors = raw["colorTokens"];
  const numbers = raw["numberTokens"];
  checkString(out, raw["textStyle"], `${path}.textStyle`, { optional: true });
  checkEnum(out, raw["strokeBounds"], `${path}.strokeBounds`, ["curve"], {
    optional: true,
  });
  checkNumber(out, raw["layoutGrow"], `${path}.layoutGrow`, {
    optional: true,
    min: 0,
  });
  checkEnum(
    out,
    raw["layoutPosition"],
    `${path}.layoutPosition`,
    ["absolute"],
    {
      optional: true,
    },
  );
  checkString(out, raw["layerName"], `${path}.layerName`, { optional: true });
  if (colors !== undefined && checkObject(out, colors, `${path}.colorTokens`)) {
    for (const field of ["fill", "stroke", "color"])
      checkString(out, colors[field], `${path}.colorTokens.${field}`, {
        optional: true,
      });
  }
  if (
    numbers !== undefined &&
    checkObject(out, numbers, `${path}.numberTokens`)
  ) {
    for (const field of [
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
    ])
      checkString(out, numbers[field], `${path}.numberTokens.${field}`, {
        optional: true,
      });
  }
  for (const field of ["horizontalConstraint", "verticalConstraint"])
    checkEnum(
      out,
      raw[field],
      `${path}.${field}`,
      ["start", "end", "center", "stretch", "scale"],
      { optional: true },
    );
  for (const field of NON_NEGATIVE_VISUAL_FIELDS) {
    const value = raw[field];
    if (typeof value === "number" && value < 0) {
      out.push(error("value.min", `${path}.${field}`, "must not be negative"));
    }
  }
  for (const field of SIZE_LIMIT_FIELDS) {
    const value = raw[field];
    if (typeof value === "number" && value < 1)
      out.push(error("value.min", `${path}.${field}`, "must be at least 1"));
  }
  if (typeof raw["aspectRatio"] === "number" && raw["aspectRatio"] <= 0)
    out.push(
      error("value.min", `${path}.aspectRatio`, "must be greater than zero"),
    );
  const ratio = raw["aspectRatio"];
  if (
    typeof ratio === "number" &&
    Number.isFinite(ratio) &&
    ratio > 0 &&
    ["minWidth", "maxWidth", "minHeight", "maxHeight"].every(
      (field) =>
        raw[field] === undefined ||
        (typeof raw[field] === "number" && Number.isFinite(raw[field])),
    )
  ) {
    const minimum = Math.max(
      (raw["minWidth"] as number | undefined) ?? 1,
      ((raw["minHeight"] as number | undefined) ?? 1) * ratio,
    );
    const maximum = Math.min(
      (raw["maxWidth"] as number | undefined) ?? Number.POSITIVE_INFINITY,
      ((raw["maxHeight"] as number | undefined) ?? Number.POSITIVE_INFINITY) *
        ratio,
    );
    if (minimum > maximum)
      out.push(
        error(
          "value.range",
          `${path}.aspectRatio`,
          "is incompatible with the authored size limits",
        ),
      );
  }
  for (const axis of ["Width", "Height"] as const) {
    const minimum = raw[`min${axis}`];
    const maximum = raw[`max${axis}`];
    if (
      typeof minimum === "number" &&
      typeof maximum === "number" &&
      minimum > maximum
    )
      out.push(
        error(
          "value.range",
          `${path}.min${axis}`,
          `must not exceed max${axis}`,
        ),
      );
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
  const strokeDashArray = style["strokeDashArray"];
  if (strokeDashArray !== undefined) {
    const values = asArray(strokeDashArray);
    if (!values) {
      out.push(
        error(
          "value.type",
          `${path}.style.strokeDashArray`,
          "must be an array",
        ),
      );
    } else {
      if (!values.length || values.length > 32)
        out.push(
          error(
            "value.range",
            `${path}.style.strokeDashArray`,
            "must contain between 1 and 32 intervals",
          ),
        );
      for (const [index, value] of values.entries())
        checkNumber(
          out,
          value,
          `${path}.style.strokeDashArray[${index}]`,
          { min: 0 },
        );
      if (values.length && values.every((value) => value === 0))
        out.push(
          error(
            "value.range",
            `${path}.style.strokeDashArray`,
            "must contain a positive interval",
          ),
        );
    }
  }
  checkEnum(
    out,
    style["strokeCap"],
    `${path}.style.strokeCap`,
    STROKE_CAP_VALUES,
    { optional: true },
  );
  checkEnum(
    out,
    style["strokeJoin"],
    `${path}.style.strokeJoin`,
    STROKE_JOIN_VALUES,
    { optional: true },
  );
  if (
    typeof style["strokeMiterLimit"] === "number" &&
    style["strokeMiterLimit"] < 1
  )
    out.push(
      error(
        "value.min",
        `${path}.style.strokeMiterLimit`,
        "must be at least 1",
      ),
    );
  checkEnum(out, style["blendMode"], `${path}.style.blendMode`, BLEND_MODES, {
    optional: true,
  });
  checkString(out, style["fontFamily"], `${path}.style.fontFamily`, {
    optional: true,
  });
  checkFontSettings(
    out,
    style["fontVariations"],
    `${path}.style.fontVariations`,
    { optional: true },
  );
  checkFontSettings(out, style["fontFeatures"], `${path}.style.fontFeatures`, {
    optional: true,
    integer: true,
  });
  checkNumber(out, style["cornerRadius"], `${path}.style.cornerRadius`, {
    optional: true,
    min: 0,
  });
  const cornerRadii = style["cornerRadii"];
  if (
    cornerRadii !== undefined &&
    checkObject(out, cornerRadii, `${path}.style.cornerRadii`)
  ) {
    for (const field of ["topLeft", "topRight", "bottomRight", "bottomLeft"])
      checkNumber(
        out,
        cornerRadii[field],
        `${path}.style.cornerRadii.${field}`,
        { min: 0 },
      );
    warnUnknownFields(
      out,
      cornerRadii,
      ["topLeft", "topRight", "bottomRight", "bottomLeft"],
      `${path}.style.cornerRadii`,
      "corner radii",
    );
  }
  const shadow = style["shadow"];
  validateGradient(out, style["fillGradient"], `${path}.style.fillGradient`);
  validateGradient(
    out,
    style["strokeGradient"],
    `${path}.style.strokeGradient`,
  );
  const effects = style["effects"];
  if (effects !== undefined) {
    if (!Array.isArray(effects))
      out.push(
        error("type.array", `${path}.style.effects`, "expected an array"),
      );
    else {
      if (effects.length > 8)
        out.push(
          error(
            "effects.max",
            `${path}.style.effects`,
            "expected at most 8 effects",
          ),
        );
      for (const [index, effect] of effects.entries()) {
        const effectPath = `${path}.style.effects[${index}]`;
        if (!checkObject(out, effect, effectPath)) continue;
        checkEnum(out, effect["type"], `${effectPath}.type`, [
          "drop-shadow",
          "layer-blur",
          "background-blur",
        ]);
        checkBoolean(out, effect["enabled"], `${effectPath}.enabled`, {
          optional: true,
        });
        checkNumber(out, effect["blur"], `${effectPath}.blur`, { min: 0 });
        if (effect["type"] === "drop-shadow") {
          for (const field of ["x", "y"])
            checkNumber(out, effect[field], `${effectPath}.${field}`);
          checkNumber(out, effect["opacity"], `${effectPath}.opacity`, {
            min: 0,
          });
          if (typeof effect["opacity"] === "number" && effect["opacity"] > 1)
            out.push(
              error("value.max", `${effectPath}.opacity`, "must not exceed 1"),
            );
          if (
            typeof effect["color"] !== "string" ||
            !/^#[\da-f]{6}$/i.test(effect["color"])
          )
            out.push(
              error(
                "value.color",
                `${effectPath}.color`,
                "expected a six-digit hex color",
              ),
            );
        }
      }
    }
  }
  if (
    shadow !== undefined &&
    checkObject(out, shadow, `${path}.style.shadow`)
  ) {
    for (const field of ["x", "y"])
      checkNumber(out, shadow[field], `${path}.style.shadow.${field}`);
    checkNumber(out, shadow["blur"], `${path}.style.shadow.blur`, { min: 0 });
    checkNumber(out, shadow["opacity"], `${path}.style.shadow.opacity`, {
      min: 0,
    });
    if (typeof shadow["opacity"] === "number" && shadow["opacity"] > 1)
      out.push(
        error("value.max", `${path}.style.shadow.opacity`, "must not exceed 1"),
      );
    if (
      typeof shadow["color"] !== "string" ||
      !/^#[\da-f]{6}$/i.test(shadow["color"])
    )
      out.push(
        error(
          "value.color",
          `${path}.style.shadow.color`,
          "expected a six-digit hex color",
        ),
      );
  }
  checkNumber(out, style["fontWeight"], `${path}.style.fontWeight`, {
    optional: true,
    min: 1,
  });
  if (typeof style["fontWeight"] === "number" && style["fontWeight"] > 1000)
    out.push(
      error("value.max", `${path}.style.fontWeight`, "must not exceed 1000"),
    );
  checkNumber(out, style["lineHeight"], `${path}.style.lineHeight`, {
    optional: true,
    min: 0.1,
  });
  checkNumber(out, style["letterSpacing"], `${path}.style.letterSpacing`, {
    optional: true,
  });
  checkEnum(
    out,
    style["fontStyle"],
    `${path}.style.fontStyle`,
    ["normal", "italic"],
    { optional: true },
  );
  checkEnum(
    out,
    style["textDecoration"],
    `${path}.style.textDecoration`,
    ["none", "underline", "line-through", "underline line-through"],
    { optional: true },
  );
  checkEnum(
    out,
    style["textAlign"],
    `${path}.style.textAlign`,
    TEXT_ALIGN_VALUES,
    { optional: true },
  );
  checkEnum(
    out,
    style["verticalAlign"],
    `${path}.style.verticalAlign`,
    ["top", "middle", "bottom"],
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
  out.push(
    ...validateAccessibilityMetadata(
      raw["accessibility"],
      `${path}.accessibility`,
    ),
  );
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
      if (page["order"] !== undefined) {
        const order = page["order"];
        if (
          typeof order !== "string" ||
          !/^[0-9A-Za-z]*[1-9A-Za-z]$/.test(order)
        )
          out.push(
            error(
              "page.order",
              `${path}.order`,
              "expected a base62 fractional key without a trailing zero",
            ),
          );
      }
      if (page["tokenMode"] !== undefined) {
        if (checkString(out, page["tokenMode"], `${path}.tokenMode`)) {
          const mode = page["tokenMode"];
          if (typeof mode === "string" && mode.toLowerCase() === "default")
            out.push(
              error(
                "page.tokenModeReserved",
                `${path}.tokenMode`,
                'the token mode name "Default" is reserved',
              ),
            );
        }
      }
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
