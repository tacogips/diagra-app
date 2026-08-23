// Small field-level check helpers used by the element type registry and the
// document validator. Each helper appends issues to `out` and reports whether
// the value was acceptable, so callers can stop descending on failure.

import { error, type ValidationIssue } from "./issues.ts";
import { isPlainObject } from "./types.ts";

/** `true` when the field is absent (`undefined`), which optional fields allow. */
function isAbsent(value: unknown): value is undefined {
  return value === undefined;
}

export function checkObject(
  out: ValidationIssue[],
  value: unknown,
  path: string,
): value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    out.push(error("type.object", path, "expected a JSON object"));
    return false;
  }
  return true;
}

export function checkArray(
  out: ValidationIssue[],
  value: unknown,
  path: string,
): value is unknown[] {
  if (!Array.isArray(value)) {
    out.push(error("type.array", path, "expected an array"));
    return false;
  }
  return true;
}

export function checkString(
  out: ValidationIssue[],
  value: unknown,
  path: string,
  options: { optional?: boolean; allowEmpty?: boolean } = {},
): boolean {
  if (isAbsent(value)) {
    if (options.optional) {
      return true;
    }
    out.push(error("field.missing", path, "required field is missing"));
    return false;
  }
  if (typeof value !== "string") {
    out.push(error("type.string", path, "expected a string"));
    return false;
  }
  if (!options.allowEmpty && value.length === 0) {
    out.push(error("value.empty", path, "must not be empty"));
    return false;
  }
  return true;
}

export function checkNumber(
  out: ValidationIssue[],
  value: unknown,
  path: string,
  options: { optional?: boolean; integer?: boolean; min?: number } = {},
): boolean {
  if (isAbsent(value)) {
    if (options.optional) {
      return true;
    }
    out.push(error("field.missing", path, "required field is missing"));
    return false;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    out.push(error("type.number", path, "expected a finite number"));
    return false;
  }
  if (options.integer && !Number.isInteger(value)) {
    out.push(error("value.integer", path, "expected an integer"));
    return false;
  }
  if (options.min !== undefined && value < options.min) {
    out.push(
      error(
        "value.min",
        path,
        `must be greater than or equal to ${options.min}`,
      ),
    );
    return false;
  }
  return true;
}

export function checkBoolean(
  out: ValidationIssue[],
  value: unknown,
  path: string,
  options: { optional?: boolean } = {},
): boolean {
  if (isAbsent(value)) {
    if (options.optional) {
      return true;
    }
    out.push(error("field.missing", path, "required field is missing"));
    return false;
  }
  if (typeof value !== "boolean") {
    out.push(error("type.boolean", path, "expected a boolean"));
    return false;
  }
  return true;
}

export function checkEnum(
  out: ValidationIssue[],
  value: unknown,
  path: string,
  allowed: readonly string[],
  options: { optional?: boolean } = {},
): boolean {
  if (isAbsent(value)) {
    if (options.optional) {
      return true;
    }
    out.push(error("field.missing", path, "required field is missing"));
    return false;
  }
  if (typeof value !== "string" || !allowed.includes(value)) {
    out.push(
      error(
        "value.enum",
        path,
        `expected one of ${allowed.map((item) => `"${item}"`).join(", ")}`,
      ),
    );
    return false;
  }
  return true;
}

/**
 * Fractional index keys are opaque lexicographic strings. We only require a
 * non-empty string so future key alphabets stay readable by this build.
 */
export function checkFractionalIndex(
  out: ValidationIssue[],
  value: unknown,
  path: string,
): boolean {
  return checkString(out, value, path);
}
